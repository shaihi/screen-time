import { neon } from "@neondatabase/serverless";

let schemaPromise: Promise<unknown> | undefined;

export function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

export async function ensureSchema() {
  if (!schemaPromise) {
    const sql = database();
    schemaPromise = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS activity_segments (
        id BIGSERIAL PRIMARY KEY,
        batch_id UUID NOT NULL,
        device_id TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 1 AND 3600),
        state TEXT NOT NULL CHECK (state IN ('active', 'media', 'idle', 'locked')),
        app_name TEXT,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (date_trunc('minute', started_at) = started_at)
      )`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_segments_dedup
        ON activity_segments (device_id, started_at, state, COALESCE(app_name, ''))`;
      await sql`CREATE INDEX IF NOT EXISTS idx_activity_segments_device_started
        ON activity_segments (device_id, started_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_activity_segments_started
        ON activity_segments (started_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS excluded_apps (
        app_name TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    })();
  }
  return schemaPromise;
}
