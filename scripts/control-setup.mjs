#!/usr/bin/env node
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function splitMigrationStatements(source) {
  const statements = [];
  let start = 0,
    quote = null,
    dollar = null,
    lineComment = false,
    blockComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index],
      next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (dollar) {
      if (source.startsWith(dollar, index)) {
        index += dollar.length - 1;
        dollar = null;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) index++;
        else quote = null;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "$") {
      const match = source
        .slice(index)
        .match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
      if (match) {
        dollar = match[0];
        index += dollar.length - 1;
        continue;
      }
    }
    if (char === ";") {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  if (quote || dollar || blockComment)
    throw new Error("Unterminated SQL literal or comment");
  const tail = source.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}
function base32(bytes) {
  let bits = 0,
    value = 0,
    result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[(value >>> bits) & 31];
    }
  }
  if (bits)
    result += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[(value << (5 - bits)) & 31];
  return result;
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "generate") {
    if (args.length !== 2 || args[0] !== "--output")
      throw new Error(
        "Usage: node scripts/control-setup.mjs generate --output .env.control.local",
      );
    const output = resolve(args[1]);
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 3072,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    const content = [
      "# Private control secrets. Never commit, share, or paste in chat.",
      "# Add the TOTP secret below to your authenticator app using manual entry.",
      "# Keep this file safe; key changes require planned device recovery.",
      `CONTROL_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
      `CONTROL_POLICY_PRIVATE_KEY_PEM=${JSON.stringify(privateKey)}`,
      `CONTROL_PARENT_TOTP_SECRET=${base32(randomBytes(20))}`,
      "",
    ].join("\n");
    await writeFile(output, content, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    console.log(
      `Created private setup file: ${output}. Secrets were not printed.`,
    );
    return;
  }
  if (command === "migrate") {
    if (args.length)
      throw new Error(
        "Usage: node --env-file=.env.local scripts/control-setup.mjs migrate",
      );
    if (!process.env.DATABASE_URL)
      throw new Error(
        "DATABASE_URL is required; load the intended database environment explicitly",
      );
    const require = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { neon } = require("@neondatabase/serverless"),
      sql = neon(process.env.DATABASE_URL);
    const [ready] =
      await sql`SELECT to_regclass('public.control_schema_migrations') IS NOT NULL AS ready`;
    if (ready?.ready) {
      const rows =
        await sql`SELECT version FROM control_schema_migrations WHERE version=1`;
      if (rows.length) {
        console.log("Control database migration 001 is already installed.");
        return;
      }
    }
    const source = await readFile(
      new URL("../dashboard/migrations/001_control_plane.sql", import.meta.url),
      "utf8",
    );
    await sql.transaction(
      splitMigrationStatements(source).map((statement) =>
        sql.query(statement, []),
      ),
    );
    console.log("Installed control database migration 001.");
    return;
  }
  throw new Error(
    "Commands: generate --output FILE | migrate (with DATABASE_URL loaded explicitly)",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Setup failed";
    if (/^(Usage:|Commands:|DATABASE_URL|EEXIST:)/.test(message))
      console.error(message);
    else
      console.error(
        "Control setup failed. Check the command, file permissions, database access, and migration configuration. No secrets were printed.",
      );
    process.exitCode = 1;
  });
