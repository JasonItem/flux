import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type {
  JobEnqueueInput,
  JobKind,
  JobPhase,
  JobStatus,
  StudioJob,
} from '../../shared/jobs'

interface JobRow {
  id: string
  kind: string
  title: string
  status: string
  phase: string
  message: string
  percent: number | null
  href: string
  dedupe_key: string
  payload_json: string
  error: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}

function nowIso(): string {
  return new Date().toISOString()
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore
  }
  return {}
}

function mapJob(row: JobRow): StudioJob {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    title: row.title,
    status: row.status as JobStatus,
    phase: row.phase as JobPhase,
    message: row.message || '',
    percent: row.percent == null ? null : Number(row.percent),
    href: row.href,
    dedupeKey: row.dedupe_key,
    payload: parsePayload(row.payload_json),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  }
}

export interface JobRepository {
  list: (limit?: number) => StudioJob[]
  get: (id: string) => StudioJob | null
  findActiveByDedupeKey: (dedupeKey: string) => StudioJob | null
  create: (input: JobEnqueueInput) => StudioJob
  update: (
    id: string,
    patch: {
      status?: JobStatus
      phase?: JobPhase
      message?: string
      percent?: number | null
      error?: string | null
      finishedAt?: string | null
    },
  ) => StudioJob | null
  resetRunningToQueued: () => number
  listQueued: () => StudioJob[]
  clearFinished: () => number
}

export function createJobRepository(db: Database.Database): JobRepository {
  const selectOne = db.prepare(`SELECT * FROM studio_jobs WHERE id = ?`)

  return {
    list: (limit = 80) => {
      const rows = db
        .prepare(
          `SELECT * FROM studio_jobs
           ORDER BY
             CASE status
               WHEN 'running' THEN 0
               WHEN 'queued' THEN 1
               WHEN 'failed' THEN 2
               WHEN 'succeeded' THEN 3
               ELSE 4
             END,
             updated_at DESC
           LIMIT ?`,
        )
        .all(limit) as JobRow[]
      return rows.map(mapJob)
    },

    get: (id) => {
      const row = selectOne.get(id) as JobRow | undefined
      return row ? mapJob(row) : null
    },

    findActiveByDedupeKey: (dedupeKey) => {
      const row = db
        .prepare(
          `SELECT * FROM studio_jobs
           WHERE dedupe_key = ? AND status IN ('queued', 'running')
           ORDER BY created_at ASC
           LIMIT 1`,
        )
        .get(dedupeKey) as JobRow | undefined
      return row ? mapJob(row) : null
    },

    create: (input) => {
      const stamp = nowIso()
      const id = randomUUID()
      db.prepare(
        `INSERT INTO studio_jobs
         (id, kind, title, status, phase, message, percent, href, dedupe_key, payload_json, error, created_at, updated_at, finished_at)
         VALUES
         (@id, @kind, @title, 'queued', 'queued', @message, NULL, @href, @dedupeKey, @payloadJson, NULL, @createdAt, @updatedAt, NULL)`,
      ).run({
        id,
        kind: input.kind,
        title: input.title,
        message: '已加入队列',
        href: input.href,
        dedupeKey: input.dedupeKey,
        payloadJson: JSON.stringify(input.payload ?? {}),
        createdAt: stamp,
        updatedAt: stamp,
      })
      return mapJob(selectOne.get(id) as JobRow)
    },

    update: (id, patch) => {
      const stamp = nowIso()
      const result = db
        .prepare(
          `UPDATE studio_jobs
           SET status = COALESCE(@status, status),
               phase = COALESCE(@phase, phase),
               message = COALESCE(@message, message),
               percent = CASE WHEN @hasPercent = 1 THEN @percent ELSE percent END,
               error = CASE
                 WHEN @clearError = 1 THEN NULL
                 WHEN @error IS NOT NULL THEN @error
                 ELSE error
               END,
               finished_at = CASE
                 WHEN @hasFinishedAt = 1 THEN @finishedAt
                 ELSE finished_at
               END,
               updated_at = @updatedAt
           WHERE id = @id`,
        )
        .run({
          id,
          status: patch.status ?? null,
          phase: patch.phase ?? null,
          message: patch.message ?? null,
          hasPercent: patch.percent !== undefined ? 1 : 0,
          percent: patch.percent ?? null,
          clearError: patch.error === null ? 1 : 0,
          error: patch.error ?? null,
          hasFinishedAt: patch.finishedAt !== undefined ? 1 : 0,
          finishedAt: patch.finishedAt ?? null,
          updatedAt: stamp,
        })
      if (result.changes === 0) return null
      const row = selectOne.get(id) as JobRow | undefined
      return row ? mapJob(row) : null
    },

    resetRunningToQueued: () => {
      const stamp = nowIso()
      const result = db
        .prepare(
          `UPDATE studio_jobs
           SET status = 'queued',
               phase = 'queued',
               message = '应用重启后重新排队',
               percent = NULL,
               updated_at = ?
           WHERE status = 'running'`,
        )
        .run(stamp)
      return Number(result.changes)
    },

    listQueued: () => {
      const rows = db
        .prepare(
          `SELECT * FROM studio_jobs
           WHERE status = 'queued'
           ORDER BY created_at ASC`,
        )
        .all() as JobRow[]
      return rows.map(mapJob)
    },

    clearFinished: () => {
      const result = db
        .prepare(
          `DELETE FROM studio_jobs
           WHERE status IN ('succeeded', 'failed', 'cancelled')`,
        )
        .run()
      return Number(result.changes)
    },
  }
}
