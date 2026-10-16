import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL engine in memory. Never reads DATABASE_URL or an external DB.
const migration = await readFile(
  new URL("../migrations/001_control_plane.sql", import.meta.url),
  "utf8",
);
const sid = "S-1-5-21-1-2-3-1001";
function initialPolicy() {
  return {
    schemaVersion: 1,
    householdId: "",
    deviceId: "pc",
    windowsSid: sid,
    revision: 1,
    issuedAtUtc: "2026-10-15T12:00:00Z",
    effectiveAtUtc: "2026-10-15T12:00:00Z",
    mode: "monitor",
    timeZone: "UTC",
    dailyLimitSeconds: 7200,
    budgetBasis: "actual_use",
    allowedWindows: [],
    grants: [],
    override: null,
  };
}
async function setup() {
  const db = new PGlite();
  await db.exec(migration);
  await db.query(
    "INSERT INTO control_enrollment_tokens(token_hash,household_id,device_id,expires_at) VALUES('token','home','pc',now()+interval '10 minutes')",
  );
  return db;
}
async function enroll(db: PGlite, token = "token") {
  return db.query<{ policy: ReturnType<typeof initialPolicy> }>(
    "SELECT control_redeem_enrollment($1,'pc',$2,'PC','encrypted',$3::jsonb) AS policy",
    [token, sid, JSON.stringify(initialPolicy())],
  );
}
async function change(
  db: PGlite,
  expected: number,
  kind: string,
  details: unknown,
  key: string | null = null,
  hash: string | null = null,
  household = "home",
) {
  return db.query<{ policy: ReturnType<typeof initialPolicy> }>(
    "SELECT control_change_policy($1,'pc',$2,$3,$4::jsonb,$5::uuid,$6) AS policy",
    [household, expected, kind, JSON.stringify(details), key, hash],
  );
}
test("migration is explicitly repeatable and enrollment redemption is one-use, device-bound, expiry-bound", async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    await assert.rejects(
      () =>
        db.query(
          "SELECT control_redeem_enrollment('token','other',$1,'PC','encrypted',$2::jsonb)",
          [sid, JSON.stringify(initialPolicy())],
        ),
      /CONTROL_ENROLLMENT_INVALID/,
    );
    const { rows } = await enroll(db);
    assert.equal(rows[0].policy.householdId, "home");
    await assert.rejects(() => enroll(db), /CONTROL_ENROLLMENT_INVALID/);
    await db.query(
      "INSERT INTO control_enrollment_tokens(token_hash,household_id,device_id,expires_at) VALUES('second','other-home','pc',now()+interval '10 minutes')",
    );
    await assert.rejects(
      () => enroll(db, "second"),
      /CONTROL_ALREADY_ENROLLED/,
    );
    const { rows: tokens } = await db.query<{ redeemed_at: string | null }>(
      "SELECT redeemed_at FROM control_enrollment_tokens WHERE token_hash='second'",
    );
    assert.equal(tokens[0].redeemed_at, null);
    await db.query(
      "INSERT INTO control_enrollment_tokens(token_hash,household_id,device_id,expires_at) VALUES('expired','home','pc',now()-interval '1 second')",
    );
    await assert.rejects(
      () => enroll(db, "expired"),
      /CONTROL_ENROLLMENT_INVALID/,
    );
  } finally {
    await db.close();
  }
});
test("CAS and household scoping protect immutable revision history", async () => {
  const db = await setup();
  try {
    await enroll(db);
    await assert.rejects(
      () =>
        change(db, 1, "policy", { mode: "managed" }, null, null, "other-home"),
      /CONTROL_DEVICE_NOT_FOUND/,
    );
    const results = await Promise.allSettled([
      change(db, 1, "policy", { mode: "managed" }),
      change(db, 1, "policy", { mode: "monitor" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    const { rows } = await db.query<{
      revision: number;
      policy: { mode: string };
    }>(
      "SELECT revision,policy FROM control_policy_revisions ORDER BY revision",
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].policy.mode, "monitor");
    assert.equal(rows[1].revision, 2);
    await assert.rejects(
      () =>
        db.query(
          'UPDATE control_policy_revisions SET policy=policy || \'{"mode":"monitor"}\'::jsonb WHERE revision=2',
        ),
      /CONTROL_IMMUTABLE_POLICY/,
    );
    await assert.rejects(
      () => db.query("DELETE FROM control_policy_revisions WHERE revision=1"),
      /CONTROL_IMMUTABLE_POLICY/,
    );
  } finally {
    await db.close();
  }
});
test("retrying a grant is atomic and idempotent even after another policy edit", async () => {
  const db = await setup();
  try {
    await enroll(db);
    const key = "13cc45d0-7f6f-4a8b-b007-8771b7a33b2a",
      grant = {
        id: key,
        day: "2026-10-15",
        seconds: 1800,
        expiresAtUtc: "2099-01-01T00:00:00Z",
      };
    const one = await change(db, 1, "grant", grant, key, "hash");
    const two = await change(db, 1, "grant", grant, key, "hash");
    assert.deepEqual(one.rows, two.rows);
    assert.equal(one.rows[0].policy.grants.length, 1);
    await change(db, 2, "policy", { mode: "managed" });
    const late = await change(db, 1, "grant", grant, key, "hash");
    assert.deepEqual(late.rows, one.rows);
    await assert.rejects(
      () => change(db, 3, "grant", grant, key, "different-hash"),
      /CONTROL_IDEMPOTENCY_CONFLICT/,
    );
    const { rows } = await db.query("SELECT * FROM control_actions");
    assert.equal(rows.length, 1);
    const audit = await db.query(
      "SELECT * FROM control_audit_events WHERE action='grant'",
    );
    assert.equal(audit.rows.length, 1);
  } finally {
    await db.close();
  }
});
test("override preserves grants and CAS prevents stale restrictions from replacing new policy", async () => {
  const db = await setup();
  try {
    await enroll(db);
    const key = "13cc45d0-7f6f-4a8b-b007-8771b7a33b2a",
      override = {
        id: key,
        untilUtc: "2099-01-01T00:00:00Z",
        ignoreBudget: true,
        ignoreSchedule: false,
      };
    await change(db, 1, "override", override, key, "override-hash");
    const result = await change(db, 2, "policy", { mode: "managed" });
    assert.deepEqual(result.rows[0].policy.override, override);
    await assert.rejects(
      () => change(db, 1, "policy", { mode: "monitor" }),
      /CONTROL_REVISION_CONFLICT/,
    );
  } finally {
    await db.close();
  }
});
test("sync rejects replay and future revisions; revocation atomically rejects old credentials and policy changes", async () => {
  const db = await setup();
  try {
    await enroll(db);
    const nonce = "13cc45d0-7f6f-4a8b-b007-8771b7a33b2a",
      status = JSON.stringify({ appliedRevision: 1, state: "allowed" });
    const sync = (
      credential = "encrypted",
      chosenNonce = nonce,
      body = status,
    ) =>
      db.query("SELECT control_sync_device('pc',$1,$2::uuid,$3::jsonb)", [
        credential,
        chosenNonce,
        body,
      ]);
    await assert.rejects(() => sync("wrong"), /CONTROL_UNAUTHORIZED/);
    await sync();
    await assert.rejects(() => sync(), /CONTROL_REPLAY/);
    await assert.rejects(
      () =>
        sync(
          "encrypted",
          "13cc45d0-7f6f-4a8b-b007-8771b7a33b2b",
          JSON.stringify({ appliedRevision: 99 }),
        ),
      /CONTROL_FUTURE_REVISION/,
    );
    await assert.rejects(
      () => db.query("SELECT control_revoke_device('other','pc')"),
      /CONTROL_DEVICE_NOT_FOUND/,
    );
    await db.query("SELECT control_revoke_device('home','pc')");
    await db.query("SELECT control_revoke_device('home','pc')");
    await assert.rejects(
      () => sync("encrypted", "13cc45d0-7f6f-4a8b-b007-8771b7a33b2c"),
      /CONTROL_UNAUTHORIZED/,
    );
    await assert.rejects(
      () => change(db, 1, "policy", { mode: "managed" }),
      /CONTROL_DEVICE_NOT_FOUND/,
    );
    const { rows } = await db.query(
      "SELECT * FROM control_audit_events WHERE action='revoked'",
    );
    assert.equal(rows.length, 1);
  } finally {
    await db.close();
  }
});
test("database tenant foreign keys prevent orphaned cross-household policies", async () => {
  const db = await setup();
  try {
    await enroll(db);
    const policy = { ...initialPolicy(), householdId: "other", revision: 2 };
    await assert.rejects(
      () =>
        db.query(
          "INSERT INTO control_policy_revisions(household_id,device_id,revision,policy) VALUES('other','pc',2,$1::jsonb)",
          [JSON.stringify(policy)],
        ),
      /foreign key constraint/,
    );
  } finally {
    await db.close();
  }
});
test("login and TOTP limits persist in PostgreSQL, reset by window, and one-time codes cannot replay", async () => {
  const db = await setup();
  try {
    for (let n = 0; n < 5; n++) {
      const { rows } = await db.query<{ accepted: boolean }>(
        "SELECT control_consume_rate_limit('login',5,300) AS accepted",
      );
      assert.equal(rows[0].accepted, true);
    }
    assert.equal(
      (
        await db.query<{ accepted: boolean }>(
          "SELECT control_consume_rate_limit('login',5,300) AS accepted",
        )
      ).rows[0].accepted,
      false,
    );
    await db.query(
      "UPDATE control_rate_limits SET window_start=now()-interval '301 seconds'",
    );
    assert.equal(
      (
        await db.query<{ accepted: boolean }>(
          "SELECT control_consume_rate_limit('login',5,300) AS accepted",
        )
      ).rows[0].accepted,
      true,
    );
    assert.equal(
      (
        await db.query<{ accepted: boolean }>(
          "SELECT control_consume_totp('home',100) AS accepted",
        )
      ).rows[0].accepted,
      true,
    );
    assert.equal(
      (
        await db.query<{ accepted: boolean }>(
          "SELECT control_consume_totp('home',100) AS accepted",
        )
      ).rows[0].accepted,
      false,
    );
    assert.equal(
      (
        await db.query<{ accepted: boolean }>(
          "SELECT control_consume_totp('other',100) AS accepted",
        )
      ).rows[0].accepted,
      true,
    );
  } finally {
    await db.close();
  }
});
test("registered parent sessions are household-scoped, expire, and revoke durably", async () => {
  const db = await setup();
  try {
    await db.query(
      "SELECT control_register_parent_session('home','hash',now()+interval '10 minutes')",
    );
    const active = async (household = "home", hash = "hash") =>
      (
        await db.query<{ active: boolean }>(
          "SELECT control_parent_session_active($1,$2) AS active",
          [household, hash],
        )
      ).rows[0].active;
    assert.equal(await active(), true);
    assert.equal(await active("other"), false);
    assert.equal(await active("home", "unknown"), false);
    await db.query("SELECT control_revoke_parent_session('other','hash')");
    assert.equal(await active(), true);
    await db.query("SELECT control_revoke_parent_session('home','hash')");
    assert.equal(await active(), false);
    await db.query(
      "SELECT control_register_parent_session('home','expired',now()-interval '1 second')",
    );
    assert.equal(await active("home", "expired"), false);
    // Re-registering an old cookie must never undo revocation.
    await db.query(
      "SELECT control_register_parent_session('home','hash',now()+interval '10 minutes')",
    );
    assert.equal(await active(), false);
  } finally {
    await db.close();
  }
});

test("future rule activation survives SQL storage and subsequent grants without early application", async () => {
  const db = await setup();
  try {
    await enroll(db);
    const future = new Date(Date.now() + 300000).toISOString();
    const delayed = await change(db, 1, "policy", {
      mode: "managed",
      effectiveAtUtc: future,
    });
    assert.equal(
      new Date(delayed.rows[0].policy.effectiveAtUtc).getTime(),
      Date.parse(future),
    );
    assert.ok(
      Date.parse(delayed.rows[0].policy.effectiveAtUtc) >
        Date.parse(delayed.rows[0].policy.issuedAtUtc),
    );
    const key = "13cc45d0-7f6f-4a8b-b007-8771b7a33b2a";
    const grant = await change(
      db,
      2,
      "grant",
      {
        id: key,
        day: "2026-10-15",
        seconds: 900,
        expiresAtUtc: "2099-01-01T00:00:00Z",
      },
      key,
      "delayed-grant",
    );
    assert.equal(
      Date.parse(grant.rows[0].policy.effectiveAtUtc),
      Date.parse(future),
    );
    await assert.rejects(
      () =>
        change(db, 3, "policy", {
          mode: "managed",
          effectiveAtUtc: new Date(Date.now() + 901000).toISOString(),
        }),
      /CONTROL_INVALID_EFFECTIVE/,
    );
    await assert.rejects(
      () =>
        change(db, 3, "policy", {
          mode: "managed",
          effectiveAtUtc: new Date(Date.now() - 31000).toISOString(),
        }),
      /CONTROL_INVALID_EFFECTIVE/,
    );
    const immediate = await change(db, 3, "policy", {
      mode: "monitor",
      effectiveAtUtc: new Date(Date.now() - 10000).toISOString(),
    });
    assert.ok(
      Date.parse(immediate.rows[0].policy.effectiveAtUtc) >=
        Date.parse(immediate.rows[0].policy.issuedAtUtc),
    );
  } finally {
    await db.close();
  }
});
