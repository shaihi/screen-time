import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createSessionToken, verifySessionToken } from "../lib/session.ts";

test("parent logins get independently revocable session identities", async () => {
  const first = await createSessionToken("family", "a long parent password");
  const second = await createSessionToken("family", "a long parent password");
  assert.notEqual(first, second);
  assert.equal(await verifySessionToken(first, () => "a long parent password"), "family");
  assert.equal(await verifySessionToken(first, () => "wrong"), null);
});

test("old signed monitoring sessions remain readable after the control upgrade", async () => {
  const payload = `family.${Math.floor(Date.now() / 1000) + 600}`;
  const token = `${payload}.${createHmac("sha256", "secret").update(payload).digest("hex")}`;
  assert.equal(await verifySessionToken(token, () => "secret"), "family");
});

test("malformed household encoding is rejected without throwing", async () => {
  assert.equal(await verifySessionToken("%broken.9999999999.signature", () => "secret"), null);
});
