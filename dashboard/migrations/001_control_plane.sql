-- Explicit migration: run only through `node scripts/control-setup.mjs migrate`.
-- No existing activity/reporting tables are altered.
CREATE TABLE IF NOT EXISTS control_schema_migrations (
  version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS control_devices (
  device_id text PRIMARY KEY CHECK (device_id ~ '^[a-zA-Z0-9._-]{1,64}$'),
  household_id text NOT NULL,
  windows_sid text NOT NULL CHECK (windows_sid ~ '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$'),
  device_name text NOT NULL,
  credential_encrypted text NOT NULL,
  current_revision bigint NOT NULL CHECK (current_revision > 0),
  revoked_at timestamptz,
  status jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, device_id)
);
CREATE TABLE IF NOT EXISTS control_policy_revisions (
  household_id text NOT NULL,
  device_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  policy jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, device_id, revision),
  FOREIGN KEY (household_id, device_id) REFERENCES control_devices(household_id, device_id),
  CHECK (policy ?& ARRAY['householdId','deviceId','revision','windowsSid','schemaVersion']
    AND policy->>'householdId' = household_id AND policy->>'deviceId' = device_id
    AND (policy->>'revision')::bigint = revision AND (policy->>'schemaVersion')::integer = 1)
);
CREATE OR REPLACE FUNCTION control_reject_policy_history_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'CONTROL_IMMUTABLE_POLICY';
END $$;
DROP TRIGGER IF EXISTS control_policy_history_immutable ON control_policy_revisions;
CREATE TRIGGER control_policy_history_immutable BEFORE UPDATE OR DELETE ON control_policy_revisions
 FOR EACH ROW EXECUTE FUNCTION control_reject_policy_history_change();
CREATE TABLE IF NOT EXISTS control_enrollment_tokens (
  token_hash text PRIMARY KEY,
  household_id text NOT NULL,
  device_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS control_request_nonces (
  device_id text NOT NULL REFERENCES control_devices(device_id),
  nonce uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (device_id, nonce)
);
CREATE TABLE IF NOT EXISTS control_actions (
  household_id text NOT NULL,
  device_id text NOT NULL,
  idempotency_key uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('grant','override')),
  request_hash text NOT NULL,
  policy jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, device_id, idempotency_key),
  FOREIGN KEY (household_id, device_id) REFERENCES control_devices(household_id, device_id)
);
CREATE TABLE IF NOT EXISTS control_audit_events (
  id bigserial PRIMARY KEY,
  household_id text NOT NULL,
  device_id text,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS control_audit_household_created ON control_audit_events(household_id,created_at DESC);
CREATE TABLE IF NOT EXISTS control_rate_limits (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);
CREATE TABLE IF NOT EXISTS control_parent_sessions (
  session_hash text PRIMARY KEY,
  household_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS control_parent_session_expiry ON control_parent_sessions(expires_at);
CREATE TABLE IF NOT EXISTS control_totp_uses (
  household_id text NOT NULL,
  counter bigint NOT NULL,
  PRIMARY KEY (household_id,counter)
);

CREATE OR REPLACE FUNCTION control_redeem_enrollment(
  p_token_hash text, p_device_id text, p_sid text, p_name text,
  p_credential text, p_policy jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t control_enrollment_tokens; result jsonb;
BEGIN
  SELECT * INTO t FROM control_enrollment_tokens WHERE token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR t.device_id<>p_device_id OR t.redeemed_at IS NOT NULL OR t.expires_at<=now()
    THEN RAISE EXCEPTION 'CONTROL_ENROLLMENT_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM control_devices WHERE device_id=p_device_id)
    THEN RAISE EXCEPTION 'CONTROL_ALREADY_ENROLLED'; END IF;
  result := p_policy || jsonb_build_object('householdId',t.household_id,'deviceId',p_device_id,'windowsSid',p_sid,'revision',1);
  INSERT INTO control_devices(device_id,household_id,windows_sid,device_name,credential_encrypted,current_revision)
    VALUES(p_device_id,t.household_id,p_sid,p_name,p_credential,1);
  INSERT INTO control_policy_revisions(household_id,device_id,revision,policy) VALUES(t.household_id,p_device_id,1,result);
  UPDATE control_enrollment_tokens SET redeemed_at=now() WHERE token_hash=p_token_hash;
  INSERT INTO control_audit_events(household_id,device_id,action,detail)
    VALUES(t.household_id,p_device_id,'enrolled',jsonb_build_object('windowsSid',p_sid));
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION control_change_policy(
  p_household text, p_device text, p_expected bigint, p_kind text,
  p_details jsonb, p_idempotency uuid DEFAULT NULL, p_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE d control_devices; old_policy jsonb; result jsonb; previous control_actions; policy_timestamp text; policy_instant timestamptz; effective_instant timestamptz;
BEGIN
  SELECT * INTO d FROM control_devices WHERE household_id=p_household AND device_id=p_device FOR UPDATE;
  IF NOT FOUND OR d.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'CONTROL_DEVICE_NOT_FOUND'; END IF;
  IF p_idempotency IS NOT NULL THEN
    SELECT * INTO previous FROM control_actions WHERE household_id=p_household AND device_id=p_device AND idempotency_key=p_idempotency;
    IF FOUND THEN
      IF previous.kind<>p_kind OR previous.request_hash<>p_hash THEN RAISE EXCEPTION 'CONTROL_IDEMPOTENCY_CONFLICT'; END IF;
      RETURN previous.policy;
    END IF;
  END IF;
  IF d.current_revision<>p_expected THEN RAISE EXCEPTION 'CONTROL_REVISION_CONFLICT'; END IF;
  SELECT policy INTO old_policy FROM control_policy_revisions WHERE household_id=p_household AND device_id=p_device AND revision=d.current_revision;
  IF p_kind='policy' THEN
    result := old_policy || p_details;
  ELSIF p_kind='grant' THEN
    result := jsonb_set(old_policy,'{grants}',COALESCE((SELECT jsonb_agg(g) FROM jsonb_array_elements(old_policy->'grants') g WHERE (g->>'expiresAtUtc')::timestamptz>now()),'[]'::jsonb) || jsonb_build_array(p_details));
  ELSIF p_kind='override' THEN
    result := jsonb_set(old_policy,'{override}',p_details);
  ELSE RAISE EXCEPTION 'CONTROL_INVALID_ACTION'; END IF;
  policy_instant := clock_timestamp();
  policy_timestamp := to_char(policy_instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  IF p_kind='policy' THEN
    effective_instant := COALESCE((p_details->>'effectiveAtUtc')::timestamptz,policy_instant);
    IF effective_instant < policy_instant - interval '30 seconds' OR effective_instant > policy_instant + interval '15 minutes'
      THEN RAISE EXCEPTION 'CONTROL_INVALID_EFFECTIVE'; END IF;
  ELSE
    -- A grant/override must not activate an already scheduled base-policy change early.
    effective_instant := COALESCE((old_policy->>'effectiveAtUtc')::timestamptz,policy_instant);
  END IF;
  effective_instant := GREATEST(effective_instant,policy_instant);
  result := result || jsonb_build_object('revision',d.current_revision+1,'issuedAtUtc',policy_timestamp,
    'effectiveAtUtc',to_char(effective_instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'householdId',p_household,'deviceId',p_device,'windowsSid',d.windows_sid,'schemaVersion',1);
  INSERT INTO control_policy_revisions(household_id,device_id,revision,policy) VALUES(p_household,p_device,d.current_revision+1,result);
  UPDATE control_devices SET current_revision=d.current_revision+1 WHERE household_id=p_household AND device_id=p_device;
  IF p_idempotency IS NOT NULL THEN
    INSERT INTO control_actions(household_id,device_id,idempotency_key,kind,request_hash,policy) VALUES(p_household,p_device,p_idempotency,p_kind,p_hash,result);
  END IF;
  INSERT INTO control_audit_events(household_id,device_id,action,detail) VALUES(p_household,p_device,p_kind,jsonb_build_object('revision',d.current_revision+1,'idempotencyKey',p_idempotency));
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION control_sync_device(p_device text,p_credential text,p_nonce uuid,p_status jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE d control_devices; result jsonb;
BEGIN
  SELECT * INTO d FROM control_devices WHERE device_id=p_device FOR UPDATE;
  IF NOT FOUND OR d.revoked_at IS NOT NULL OR d.credential_encrypted<>p_credential THEN RAISE EXCEPTION 'CONTROL_UNAUTHORIZED'; END IF;
  IF EXISTS(SELECT 1 FROM control_request_nonces WHERE device_id=p_device AND nonce=p_nonce) THEN RAISE EXCEPTION 'CONTROL_REPLAY'; END IF;
  DELETE FROM control_request_nonces WHERE device_id=p_device AND expires_at<now();
  INSERT INTO control_request_nonces(device_id,nonce,expires_at) VALUES(p_device,p_nonce,now()+interval '11 minutes');
  IF (p_status->>'appliedRevision')::bigint>d.current_revision THEN RAISE EXCEPTION 'CONTROL_FUTURE_REVISION'; END IF;
  UPDATE control_devices SET status=p_status,last_seen_at=now() WHERE device_id=p_device;
  SELECT policy INTO result FROM control_policy_revisions WHERE household_id=d.household_id AND device_id=p_device AND revision=d.current_revision;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION control_revoke_device(p_household text,p_device text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE d control_devices;
BEGIN
 SELECT * INTO d FROM control_devices WHERE household_id=p_household AND device_id=p_device FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONTROL_DEVICE_NOT_FOUND'; END IF;
 IF d.revoked_at IS NULL THEN
  UPDATE control_devices SET revoked_at=now() WHERE household_id=p_household AND device_id=p_device;
  INSERT INTO control_audit_events(household_id,device_id,action) VALUES(p_household,p_device,'revoked');
 END IF;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION control_consume_rate_limit(p_bucket text,p_limit integer,p_seconds integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE hits integer;
BEGIN
 DELETE FROM control_rate_limits WHERE window_start<now()-interval '2 days';
 INSERT INTO control_rate_limits(bucket,window_start,attempts) VALUES(p_bucket,now(),1)
 ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN control_rate_limits.window_start<=now()-make_interval(secs=>p_seconds) THEN 1 ELSE LEAST(control_rate_limits.attempts+1,p_limit+1) END,
 window_start=CASE WHEN control_rate_limits.window_start<=now()-make_interval(secs=>p_seconds) THEN now() ELSE control_rate_limits.window_start END RETURNING attempts INTO hits;
 RETURN hits<=p_limit;
END $$;
CREATE OR REPLACE FUNCTION control_consume_totp(p_household text,p_counter bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE accepted bigint;
BEGIN
 DELETE FROM control_totp_uses WHERE counter<p_counter-10;
 INSERT INTO control_totp_uses(household_id,counter) VALUES(p_household,p_counter) ON CONFLICT DO NOTHING RETURNING counter INTO accepted;
 RETURN accepted IS NOT NULL;
END $$;
CREATE OR REPLACE FUNCTION control_register_parent_session(p_household text,p_hash text,p_expires timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM control_parent_sessions WHERE expires_at<now()-interval '1 day';
 INSERT INTO control_parent_sessions(session_hash,household_id,expires_at) VALUES(p_hash,p_household,p_expires) ON CONFLICT(session_hash) DO NOTHING;
END $$;
CREATE OR REPLACE FUNCTION control_revoke_parent_session(p_household text,p_hash text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE control_parent_sessions SET revoked_at=now() WHERE session_hash=p_hash AND household_id=p_household;
END $$;
CREATE OR REPLACE FUNCTION control_parent_session_active(p_household text,p_hash text)
RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM control_parent_sessions WHERE session_hash=p_hash AND household_id=p_household AND expires_at>now() AND revoked_at IS NULL);
$$;
INSERT INTO control_schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
