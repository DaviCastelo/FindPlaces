import { Pool } from "pg";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

const databaseUrl = process.env.DATABASE_URL?.trim();
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } }) : null;
let schemaReady = false;

const jsonStore = new Map<string, { value: JsonValue; updatedAt: string }>();

function keyFor(scope: string, id: string): string {
  return `${scope}:${id}`;
}

async function ensureSchema(): Promise<void> {
  if (!pool || schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      scope TEXT NOT NULL,
      state_key TEXT NOT NULL,
      state_value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scope, state_key)
    );
    CREATE TABLE IF NOT EXISTS app_metrics_events (
      id BIGSERIAL PRIMARY KEY,
      event_name TEXT NOT NULL,
      category TEXT,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS app_enrichment_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      payload JSONB NOT NULL,
      result JSONB,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS app_leads (
      lead_id TEXT PRIMARY KEY,
      lead_payload JSONB NOT NULL,
      contact_source TEXT,
      legal_basis TEXT NOT NULL,
      purpose TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS app_cache_entries (
      cache_key TEXT PRIMARY KEY,
      cache_payload JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      cache_version INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS app_compliance_audit (
      id BIGSERIAL PRIMARY KEY,
      lead_id TEXT NOT NULL,
      data_source TEXT,
      legal_basis TEXT NOT NULL,
      purpose TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payload JSONB NOT NULL
    );
  `);
  schemaReady = true;
}

export async function readState<T>(scope: string, id: string): Promise<{ value: T; updatedAt: string } | undefined> {
  if (!pool) {
    const local = jsonStore.get(keyFor(scope, id));
    if (!local) return undefined;
    return { value: local.value as T, updatedAt: local.updatedAt };
  }
  await ensureSchema();
  const result = await pool.query<{ state_value: T; updated_at: string }>(
    `SELECT state_value, updated_at::text FROM app_state WHERE scope = $1 AND state_key = $2`,
    [scope, id],
  );
  if (!result.rowCount) return undefined;
  return { value: result.rows[0].state_value, updatedAt: result.rows[0].updated_at };
}

export async function writeState(scope: string, id: string, value: JsonValue): Promise<string> {
  const now = new Date().toISOString();
  if (!pool) {
    jsonStore.set(keyFor(scope, id), { value, updatedAt: now });
    return now;
  }
  await ensureSchema();
  const result = await pool.query<{ updated_at: string }>(
    `
      INSERT INTO app_state (scope, state_key, state_value, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (scope, state_key)
      DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = NOW()
      RETURNING updated_at::text
    `,
    [scope, id, JSON.stringify(value)],
  );
  return result.rows[0].updated_at;
}

export async function appendMetricEvent(eventName: string, category: string | undefined, payload: JsonValue): Promise<void> {
  if (!pool) {
    const entries = (jsonStore.get("metrics:events")?.value as unknown[] | undefined) ?? [];
    entries.push({ eventName, category, payload, createdAt: new Date().toISOString() });
    jsonStore.set("metrics:events", { value: entries, updatedAt: new Date().toISOString() });
    return;
  }
  await ensureSchema();
  await pool.query(
    `INSERT INTO app_metrics_events (event_name, category, payload) VALUES ($1, $2, $3::jsonb)`,
    [eventName, category ?? null, JSON.stringify(payload)],
  );
}

export async function listMetricEvents(limit = 1000): Promise<Array<{ eventName: string; category?: string; payload: JsonValue; createdAt: string }>> {
  if (!pool) {
    const entries = (jsonStore.get("metrics:events")?.value as Array<{ eventName: string; category?: string; payload: JsonValue; createdAt: string }> | undefined) ?? [];
    return entries.slice(-limit);
  }
  await ensureSchema();
  const result = await pool.query<{ event_name: string; category: string | null; payload: JsonValue; created_at: string }>(
    `
      SELECT event_name, category, payload, created_at::text
      FROM app_metrics_events
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [limit],
  );
  return result.rows.map((row) => ({
    eventName: row.event_name,
    category: row.category ?? undefined,
    payload: row.payload,
    createdAt: row.created_at,
  }));
}

export async function upsertLead(leadId: string, payload: JsonValue, contactSource: string | undefined, legalBasis: string, purpose: string): Promise<void> {
  if (!pool) {
    jsonStore.set(
      keyFor("lead", leadId),
      { value: { payload, contactSource, legalBasis, purpose }, updatedAt: new Date().toISOString() },
    );
    return;
  }
  await ensureSchema();
  await pool.query(
    `
      INSERT INTO app_leads (lead_id, lead_payload, contact_source, legal_basis, purpose, updated_at)
      VALUES ($1, $2::jsonb, $3, $4, $5, NOW())
      ON CONFLICT (lead_id)
      DO UPDATE SET
        lead_payload = EXCLUDED.lead_payload,
        contact_source = EXCLUDED.contact_source,
        legal_basis = EXCLUDED.legal_basis,
        purpose = EXCLUDED.purpose,
        updated_at = NOW()
    `,
    [leadId, JSON.stringify(payload), contactSource ?? null, legalBasis, purpose],
  );
}

export async function appendComplianceAudit(leadId: string, dataSource: string | undefined, legalBasis: string, purpose: string, payload: JsonValue): Promise<void> {
  if (!pool) {
    const current = (jsonStore.get("compliance:audit")?.value as unknown[] | undefined) ?? [];
    current.push({ leadId, dataSource, legalBasis, purpose, payload, occurredAt: new Date().toISOString() });
    jsonStore.set("compliance:audit", { value: current, updatedAt: new Date().toISOString() });
    return;
  }
  await ensureSchema();
  await pool.query(
    `
      INSERT INTO app_compliance_audit (lead_id, data_source, legal_basis, purpose, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [leadId, dataSource ?? null, legalBasis, purpose, JSON.stringify(payload)],
  );
}

export type PersistedJob = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  payload: JsonValue;
  result?: JsonValue;
  error?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export async function saveJob(job: PersistedJob): Promise<void> {
  if (!pool) {
    jsonStore.set(keyFor("job", job.id), { value: job, updatedAt: job.updatedAt });
    return;
  }
  await ensureSchema();
  await pool.query(
    `
      INSERT INTO app_enrichment_jobs (id, status, payload, result, error, attempts, created_at, updated_at, started_at, finished_at)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::timestamptz)
      ON CONFLICT (id)
      DO UPDATE SET
        status = EXCLUDED.status,
        payload = EXCLUDED.payload,
        result = EXCLUDED.result,
        error = EXCLUDED.error,
        attempts = EXCLUDED.attempts,
        updated_at = EXCLUDED.updated_at,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at
    `,
    [
      job.id,
      job.status,
      JSON.stringify(job.payload),
      JSON.stringify(job.result ?? null),
      job.error ?? null,
      job.attempts,
      job.createdAt,
      job.updatedAt,
      job.startedAt ?? null,
      job.finishedAt ?? null,
    ],
  );
}

export async function loadJob(jobId: string): Promise<PersistedJob | undefined> {
  if (!pool) {
    return jsonStore.get(keyFor("job", jobId))?.value as PersistedJob | undefined;
  }
  await ensureSchema();
  const result = await pool.query<{
    id: string;
    status: PersistedJob["status"];
    payload: JsonValue;
    result: JsonValue | null;
    error: string | null;
    attempts: number;
    created_at: string;
    updated_at: string;
    started_at: string | null;
    finished_at: string | null;
  }>(
    `
      SELECT id, status, payload, result, error, attempts, created_at::text, updated_at::text, started_at::text, finished_at::text
      FROM app_enrichment_jobs
      WHERE id = $1
    `,
    [jobId],
  );
  if (!result.rowCount) return undefined;
  const row = result.rows[0];
  return {
    id: row.id,
    status: row.status,
    payload: row.payload,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
  };
}

export type CachedQueryEntry = {
  key: string;
  payload: JsonValue;
  expiresAt: string;
  cacheVersion: number;
  updatedAt: string;
};

export async function putCachedQuery(entry: CachedQueryEntry): Promise<void> {
  if (!pool) {
    jsonStore.set(keyFor("query", entry.key), { value: entry, updatedAt: entry.updatedAt });
    return;
  }
  await ensureSchema();
  await pool.query(
    `
      INSERT INTO app_cache_entries (cache_key, cache_payload, expires_at, cache_version, updated_at)
      VALUES ($1, $2::jsonb, $3::timestamptz, $4, $5::timestamptz)
      ON CONFLICT (cache_key)
      DO UPDATE SET
        cache_payload = EXCLUDED.cache_payload,
        expires_at = EXCLUDED.expires_at,
        cache_version = EXCLUDED.cache_version,
        updated_at = EXCLUDED.updated_at
    `,
    [entry.key, JSON.stringify(entry.payload), entry.expiresAt, entry.cacheVersion, entry.updatedAt],
  );
}

export async function getCachedQuery(key: string): Promise<CachedQueryEntry | undefined> {
  if (!pool) {
    const entry = jsonStore.get(keyFor("query", key))?.value as CachedQueryEntry | undefined;
    return entry;
  }
  await ensureSchema();
  const result = await pool.query<{ cache_key: string; cache_payload: JsonValue; expires_at: string; cache_version: number; updated_at: string }>(
    `
      SELECT cache_key, cache_payload, expires_at::text, cache_version, updated_at::text
      FROM app_cache_entries
      WHERE cache_key = $1
    `,
    [key],
  );
  if (!result.rowCount) return undefined;
  const row = result.rows[0];
  return {
    key: row.cache_key,
    payload: row.cache_payload,
    expiresAt: row.expires_at,
    cacheVersion: row.cache_version,
    updatedAt: row.updated_at,
  };
}

export async function clearCachedQueries(): Promise<void> {
  if (!pool) {
    for (const key of Array.from(jsonStore.keys())) {
      if (key.startsWith("query:")) jsonStore.delete(key);
    }
    return;
  }
  await ensureSchema();
  await pool.query(`DELETE FROM app_cache_entries`);
}

