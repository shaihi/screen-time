import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createPrivateKey } from "node:crypto";
import { fileURLToPath } from "node:url";
// The deployment helper is deliberately plain Node.js, without a TS runtime dependency.
// @ts-expect-error The .mjs CLI has no declaration file.
import { splitMigrationStatements } from "../../scripts/control-setup.mjs";

test("migration splitting preserves dollar-quoted functions, SQL strings and comments", async () => {
  const source =
    "-- comment;\nSELECT 'a;''b'; CREATE FUNCTION test() RETURNS void AS $$ BEGIN PERFORM 1; END $$ LANGUAGE plpgsql; /* ; */ SELECT \"semi;colon\";";
  const statements = splitMigrationStatements(source);
  assert.equal(statements.length, 3);
  assert.match(statements[1], /PERFORM 1; END/);
  assert.throws(() => splitMigrationStatements("SELECT 'unterminated"));
  const migration = await readFile(
    new URL("../migrations/001_control_plane.sql", import.meta.url),
    "utf8",
  );
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    for (const statement of splitMigrationStatements(migration))
      await db.exec(statement);
    const result = await db.query(
      "SELECT version FROM control_schema_migrations",
    );
    assert.equal(result.rows.length, 1);
  } finally {
    await db.close();
  }
});
test("secret generation creates a private new file, prints no secrets, refuses overwriting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screentime-control-setup-"));
  try {
    const path = join(dir, "secrets.env"),
      script = new URL("../../scripts/control-setup.mjs", import.meta.url);
    const run = spawnSync(
      process.execPath,
      [fileURLToPath(script), "generate", "--output", path],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const source = await readFile(path, "utf8"),
      secret = source.match(/^CONTROL_PARENT_TOTP_SECRET=(.+)$/m)![1],
      encrypted = source.match(/^CONTROL_ENCRYPTION_KEY=(.+)$/m)![1],
      pem = JSON.parse(
        source.match(/^CONTROL_POLICY_PRIVATE_KEY_PEM=(.+)$/m)![1],
      );
    assert.equal(Buffer.from(encrypted, "base64").length, 32);
    assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.equal(
      createPrivateKey(pem).asymmetricKeyDetails?.modulusLength,
      3072,
    );
    assert.ok(
      !run.stdout.includes(secret) &&
        !run.stdout.includes(encrypted) &&
        !run.stdout.includes("PRIVATE KEY"),
    );
    if (process.platform !== "win32")
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    const second = spawnSync(
      process.execPath,
      [fileURLToPath(script), "generate", "--output", path],
      { encoding: "utf8" },
    );
    assert.notEqual(second.status, 0);
    assert.equal(await readFile(path, "utf8"), source);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
