import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  verify,
} from "node:crypto";
import {
  encryptCredential,
  decryptCredential,
  signControlEnvelope,
  validatePolicyEdit,
  validateGrant,
  validateOverride,
  validateShutdown,
  validateSync,
  verifyDeviceSignature,
  totpCode,
  verifyTotp,
  createStepUpToken,
  verifyStepUpToken,
  policyDayAndExpiry,
} from "../lib/control.ts";

const key = Buffer.alloc(32, 7).toString("base64");
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
test("shutdown action requires an exact revision and boolean state", () => {
  assert.deepEqual(validateShutdown({ expectedRevision: 4, shutdown: true }), {
    expectedRevision: 4,
    shutdown: true,
  });
  assert.throws(() => validateShutdown({ expectedRevision: 4, shutdown: "yes" }));
  assert.throws(() => validateShutdown({ expectedRevision: 0, shutdown: true }));
  assert.throws(() => validateShutdown({ expectedRevision: 4, shutdown: true, command: "anything" }));
});
test("device credentials are authenticated, target-bound ciphertext", () => {
  const encrypted = encryptCredential("secret", "pc", key);
  assert.equal(decryptCredential(encrypted, "pc", key), "secret");
  assert.throws(() => decryptCredential(encrypted, "other", key));
  assert.throws(() =>
    decryptCredential(encrypted, "pc", Buffer.alloc(32, 8).toString("base64")),
  );
  assert.notEqual(encryptCredential("secret", "pc", key), encrypted);
});
test("policy signatures verify the exact payload including authenticated server time", () => {
  const signed = signControlEnvelope(
    { revision: 1 },
    privateKey,
    new Date("2026-10-15T12:00:00Z"),
  );
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(signed.payload, "base64"),
      generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey,
      Buffer.from(signed.signature, "base64"),
    ),
    false,
  );
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(signed.payload, "base64"),
      privateKey,
      Buffer.from(signed.signature, "base64"),
    ),
    true,
  );
  assert.deepEqual(
    JSON.parse(Buffer.from(signed.payload, "base64").toString()),
    { policy: { revision: 1 }, serverTimeUtc: "2026-10-15T12:00:00.000Z" },
  );
});
test("rule validation rejects malformed limits, schedules, zones, and unknown fields", () => {
  const good = {
    expectedRevision: 1,
    mode: "managed",
    timeZone: "Asia/Jerusalem",
    dailyLimitSeconds: 7200,
    budgetBasis: "actual_use",
    allowedWindows: [{ dayOfWeek: 0, startMinute: 60, endMinute: 120 }],
  };
  assert.deepEqual(validatePolicyEdit(good), good);
  for (const bad of [
    { ...good, dailyLimitSeconds: 0 },
    { ...good, timeZone: "fake" },
    {
      ...good,
      allowedWindows: [{ dayOfWeek: 7, startMinute: 60, endMinute: 120 }],
    },
    {
      ...good,
      allowedWindows: [{ dayOfWeek: 0, startMinute: 120, endMinute: 60 }],
    },
    { ...good, windowsSid: "S-1-5-18" },
  ])
    assert.throws(() => validatePolicyEdit(bad));
});
test("grants and overrides require CAS, UUID idempotency, explicit bounded scope", () => {
  const base = {
    expectedRevision: 1,
    idempotencyKey: "13cc45d0-7f6f-4a8b-b007-8771b7a33b2a",
  };
  assert.equal(validateGrant({ ...base, minutes: 30 }).minutes, 30);
  assert.throws(() => validateGrant({ ...base, minutes: 0 }));
  const now = new Date("2026-10-15T12:00:00Z");
  assert.equal(
    validateOverride(
      {
        ...base,
        untilUtc: "2026-10-15T13:00:00Z",
        ignoreBudget: true,
        ignoreSchedule: false,
      },
      now,
    ).ignoreBudget,
    true,
  );
  assert.throws(() =>
    validateOverride(
      {
        ...base,
        untilUtc: "2026-10-17T12:00:00Z",
        ignoreBudget: true,
        ignoreSchedule: false,
      },
      now,
    ),
  );
  assert.throws(() =>
    validateOverride(
      {
        ...base,
        untilUtc: "2026-10-15T13:00:00Z",
        ignoreBudget: false,
        ignoreSchedule: false,
      },
      now,
    ),
  );
});
test("sync authentication binds exact bytes, method, path, nonce, target and time", () => {
  const deviceId = "family-pc",
    body = '{"protocolVersion":1}',
    timestamp = "1792065600",
    nonce = "13cc45d0-7f6f-4a8b-b007-8771b7a33b2a",
    credential = Buffer.alloc(32, 6).toString("base64");
  const request = { deviceId, timestamp, nonce, signature: "", body };
  // Fixed interop vector uses an independently constructed canonical message.
  request.signature = createHmac("sha256", Buffer.from(credential, "base64"))
    .update(
      `v1\nPOST\n/api/agent/control/sync\n${deviceId}\n${timestamp}\n${nonce}\n${createHash("sha256").update(body).digest("hex")}`,
    )
    .digest("hex");
  assert.equal(
    verifyDeviceSignature(request, credential, Number(timestamp) * 1000),
    true,
  );
  assert.equal(
    verifyDeviceSignature(
      { ...request, body: body + " " },
      credential,
      Number(timestamp) * 1000,
    ),
    false,
  );
  assert.equal(
    verifyDeviceSignature(
      request,
      credential,
      (Number(timestamp) + 301) * 1000,
    ),
    false,
  );
  assert.equal(
    verifyDeviceSignature(
      { ...request, nonce: "bad" },
      credential,
      Number(timestamp) * 1000,
    ),
    false,
  );
});
test("sync status rejects impossible counters and unbounded errors", () => {
  const valid = {
    protocolVersion: 1,
    appliedRevision: 1,
    state: "allowed",
    reason: "Within rules",
    usedSeconds: 100,
    remainingSeconds: null,
    policyDay: "2026-10-15",
    sensorHealthy: true,
    agentVersion: "2.1.0",
    error: null,
  };
  assert.deepEqual(validateSync(valid), valid);
  assert.throws(() => validateSync({ ...valid, usedSeconds: -1 }));
  assert.throws(() => validateSync({ ...valid, state: "signed-out" }));
  assert.throws(() => validateSync({ ...valid, error: "e".repeat(1001) }));
});
test("TOTP follows RFC6238 SHA1 vectors and accepts only six-digit current-window codes", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totpCode(secret, 59000), "287082");
  assert.equal(verifyTotp("287082", secret, 59000), true);
  assert.equal(verifyTotp("287082", secret, 59000 + 90000), false);
  assert.equal(verifyTotp("2870820", secret, 59000), false);
  assert.equal(verifyTotp("000000", "", 59000), false);
});
test("step-up is short-lived and bound to exact household session", () => {
  const token = createStepUpToken("a", "session-one", key, 1000);
  assert.equal(verifyStepUpToken(token, "a", "session-one", key, 1001), true);
  assert.equal(verifyStepUpToken(token, "b", "session-one", key, 1001), false);
  assert.equal(verifyStepUpToken(token, "a", "session-two", key, 1001), false);
  assert.equal(
    verifyStepUpToken(token, "a", "session-one", key, 1000 + 601000),
    false,
  );
});
test("grant expiry follows next policy midnight including DST", () => {
  assert.deepEqual(
    policyDayAndExpiry("Asia/Jerusalem", new Date("2026-10-15T22:30:00Z")),
    { day: "2026-10-16", expiresAtUtc: "2026-10-16T21:00:00.000Z" },
  );
  assert.deepEqual(
    policyDayAndExpiry("UTC", new Date("2026-10-15T12:00:00Z")),
    { day: "2026-10-15", expiresAtUtc: "2026-10-16T00:00:00.000Z" },
  );
});

test("parent authorization ignores forged household headers, verifies cookie, and enforces revocation", async () => {
  const { authenticateControlParent, requireSameOrigin, controlRequestJson } =
    await import("../lib/parent-control.ts");
  const { createSessionToken, sessionCookieName } =
    await import("../lib/session.ts");
  const household = {
    id: "home",
    password: "unique-parent-password",
    ingestSecret: "x".repeat(32),
    deviceIds: ["pc"],
  };
  const deps = {
    getHousehold: (id: string) => (id === "home" ? household : null),
    sessionActive: async () => true,
    ready: async () => true,
  };
  await assert.rejects(
    () =>
      authenticateControlParent(
        new Request("https://test/api/control/devices", {
          headers: { "x-screen-time-household": "home" },
        }),
        deps,
      ),
    /Parent login/,
  );
  const token = await createSessionToken(household.id, household.password);
  const request = new Request("https://test/api/control/devices", {
    headers: {
      cookie: `${sessionCookieName}=${token}`,
      "x-screen-time-household": "other",
    },
  });
  const before = process.env.CONTROL_PARENT_TOTP_SECRET;
  process.env.CONTROL_PARENT_TOTP_SECRET = "required";
  try {
    assert.equal(
      (await authenticateControlParent(request, deps)).household.id,
      "home",
    );
    await assert.rejects(
      () =>
        authenticateControlParent(request, {
          ...deps,
          sessionActive: async () => false,
        }),
      /Sign in again/,
    );
    await assert.rejects(
      () =>
        authenticateControlParent(request, {
          ...deps,
          ready: async () => false,
        }),
      /migration/,
    );
    await assert.rejects(
      () =>
        authenticateControlParent(
          new Request("https://test/api/control/devices", {
            headers: { cookie: `${sessionCookieName}=${token}bad` },
          }),
          deps,
        ),
      /Parent login/,
    );
  } finally {
    if (before === undefined) delete process.env.CONTROL_PARENT_TOTP_SECRET;
    else process.env.CONTROL_PARENT_TOTP_SECRET = before;
  }
  assert.throws(
    () =>
      requireSameOrigin(
        new Request("https://test/api/control/unlock", { method: "POST" }),
      ),
    /Same-origin/,
  );
  assert.throws(
    () =>
      requireSameOrigin(
        new Request("https://test/api/control/unlock", {
          method: "POST",
          headers: { origin: "https://evil" },
        }),
      ),
    /Same-origin/,
  );
  requireSameOrigin(
    new Request("https://test/api/control/unlock", {
      method: "POST",
      headers: { origin: "https://test" },
    }),
  );
  await assert.rejects(
    () =>
      controlRequestJson(
        new Request("https://test", {
          method: "POST",
          body: "x".repeat(20000),
        }),
      ),
    /too large/,
  );
  await assert.rejects(
    () =>
      controlRequestJson(
        new Request("https://test", { method: "POST", body: "{" }),
      ),
    /Invalid JSON/,
  );
  await assert.rejects(
    () =>
      controlRequestJson(
        new Request("https://test", {
          method: "POST",
          body: new Uint8Array([255]),
        }),
      ),
    /UTF-8/,
  );
});

test("control write guard rejects forged identity and missing or cross-origin mutations", async () => {
  const { requireControlWrite, requireControlHttps, controlRoute } =
    await import("../lib/parent-control.ts");
  for (const headers of [
    { "x-screen-time-household": "home" },
    { cookie: "screen_time_session=malformed", origin: "https://test" },
    { "x-screen-time-household": "home", origin: "https://test" },
    { origin: "https://evil" },
  ] as Record<string, string>[]) {
    const response = await controlRoute(async () => {
      await requireControlWrite(
        new Request("https://test/api/control/devices/pc/policy", {
          method: "PUT",
          headers,
        }),
      );
      return Response.json({ unexpected: true });
    });
    assert.ok([401, 403].includes(response.status));
    assert.equal(response.headers.get("cache-control"), "no-store, private");
  }
  assert.throws(
    () =>
      requireControlHttps(new Request("http://test/api/agent/control/enroll")),
    /HTTPS/,
  );
  requireControlHttps(new Request("https://test/api/agent/control/enroll"));
});

test("policy edits accept bounded future activation and normalize small client clock skew", () => {
  const base = {
    expectedRevision: 1,
    mode: "managed",
    timeZone: "Asia/Jerusalem",
    dailyLimitSeconds: 7200,
    budgetBasis: "actual_use",
    allowedWindows: [],
  };
  const now = new Date("2026-10-15T12:00:00.000Z");
  assert.equal(
    validatePolicyEdit({ ...base, effectiveAtUtc: "2026-10-15T12:05:00Z" }, now)
      .effectiveAtUtc,
    "2026-10-15T12:05:00.000Z",
  );
  assert.equal(
    validatePolicyEdit({ ...base, effectiveAtUtc: "2026-10-15T11:59:50Z" }, now)
      .effectiveAtUtc,
    now.toISOString(),
  );
  assert.throws(() =>
    validatePolicyEdit(
      { ...base, effectiveAtUtc: "2026-10-15T11:59:29Z" },
      now,
    ),
  );
  assert.throws(() =>
    validatePolicyEdit(
      { ...base, effectiveAtUtc: "2026-10-15T12:15:01Z" },
      now,
    ),
  );
  assert.throws(() =>
    validatePolicyEdit({ ...base, effectiveAtUtc: "bad" }, now),
  );
  assert.equal(validatePolicyEdit(base, now).effectiveAtUtc, undefined);
});

test("same-origin validation follows browser Host when Next normalizes the internal URL", async () => {
  const { requireSameOrigin, requireControlHttps } =
    await import("../lib/parent-control.ts");
  const originalPublic = process.env.CONTROL_PUBLIC_ORIGIN,
    originalVercel = process.env.VERCEL;
  delete process.env.CONTROL_PUBLIC_ORIGIN;
  delete process.env.VERCEL;
  try {
    requireSameOrigin(
      new Request("http://localhost:3407/api/control/unlock", {
        headers: { host: "127.0.0.1:3407", origin: "http://127.0.0.1:3407" },
      }),
    );
    assert.throws(
      () =>
        requireSameOrigin(
          new Request("http://localhost:3407/api/control/unlock", {
            headers: {
              host: "127.0.0.1:3407",
              origin: "http://localhost:3407",
            },
          }),
        ),
      /Same-origin/,
    );
    assert.throws(
      () =>
        requireSameOrigin(
          new Request("http://localhost:3407/api/control/unlock", {
            headers: {
              host: "127.0.0.1:3407",
              "x-forwarded-proto": "https",
              origin: "https://127.0.0.1:3407",
            },
          }),
        ),
      /Same-origin/,
    );
    assert.throws(
      () =>
        requireControlHttps(
          new Request("http://localhost/api/agent/control/enroll", {
            headers: { "x-forwarded-proto": "https" },
          }),
        ),
      /HTTPS/,
    );
    process.env.VERCEL = "1";
    requireSameOrigin(
      new Request("http://localhost/api/control/unlock", {
        headers: {
          host: "family.example",
          "x-forwarded-proto": "https",
          origin: "https://family.example",
        },
      }),
    );
    requireControlHttps(
      new Request("http://localhost/api/agent/control/enroll", {
        headers: { "x-forwarded-proto": "https" },
      }),
    );
    process.env.CONTROL_PUBLIC_ORIGIN = "https://parent.example";
    requireSameOrigin(
      new Request("http://localhost/api/control/unlock", {
        headers: { host: "internal.example", origin: "https://parent.example" },
      }),
    );
    assert.throws(
      () =>
        requireSameOrigin(
          new Request("http://localhost/api/control/unlock", {
            headers: {
              host: "internal.example",
              origin: "http://internal.example",
            },
          }),
        ),
      /Same-origin/,
    );
    delete process.env.CONTROL_PUBLIC_ORIGIN;
    assert.throws(
      () =>
        requireSameOrigin(
          new Request("http://localhost/api/control/unlock", {
            headers: {
              host: "evil.example@family.example",
              origin: "https://family.example",
            },
          }),
        ),
      /Same-origin/,
    );
  } finally {
    if (originalPublic === undefined) delete process.env.CONTROL_PUBLIC_ORIGIN;
    else process.env.CONTROL_PUBLIC_ORIGIN = originalPublic;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  }
});
