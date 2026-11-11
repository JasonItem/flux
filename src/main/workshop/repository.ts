import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import {
  buildFullScriptText,
  type WorkshopScriptDetail,
  type WorkshopScriptSegment,
  type WorkshopScriptStatus,
  type WorkshopScriptSummary,
  type WorkshopScriptUpdateInput,
} from '../../shared/workshop'

interface ScriptRow {
  id: string
  title: string
  status: string
  source_research_video_id: string | null
  source_aweme_id: string | null
  source_title: string | null
  topic_id: string | null
  topic_title: string
  video_type: string
  angle: string
  duration_hint_sec: number
  summary: string
  segments_json: string
  hooks_json: string
  cta_options_json: string
  comment_insights_json: string
  full_script_text: string
  error: string | null
  created_at: string
  updated_at: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function parseSegments(raw: string): WorkshopScriptSegment[] {
  return parseJsonArray<Partial<WorkshopScriptSegment>>(raw)
    .map((item, index) => ({
      order: typeof item.order === 'number' ? item.order : index,
      title: String(item.title ?? `段落${String(index + 1)}`).trim() || `段落${String(index + 1)}`,
      purpose: String(item.purpose ?? '讲点').trim() || '讲点',
      beatSec: Math.max(0, Number(item.beatSec ?? 0) || 0),
      spokenText: String(item.spokenText ?? '').trim(),
      why: String(item.why ?? '').trim(),
      editHint: String(item.editHint ?? '').trim(),
      sourceKeyLines: Array.isArray(item.sourceKeyLines)
        ? item.sourceKeyLines.map((line) => String(line).trim()).filter(Boolean)
        : [],
    }))
    .sort((a, b) => a.order - b.order)
}

function mapSummary(row: ScriptRow): WorkshopScriptSummary {
  const segments = parseSegments(row.segments_json)
  return {
    id: row.id,
    title: row.title,
    status: (row.status as WorkshopScriptStatus) || 'draft',
    sourceResearchVideoId: row.source_research_video_id,
    sourceTitle: row.source_title,
    topicId: row.topic_id,
    topicTitle: row.topic_title || '',
    videoType: row.video_type || '其他',
    angle: row.angle || '',
    durationHintSec: row.duration_hint_sec || 0,
    segmentCount: segments.length,
    summary: row.summary || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDetail(row: ScriptRow): WorkshopScriptDetail {
  const segments = parseSegments(row.segments_json)
  return {
    ...mapSummary(row),
    sourceAwemeId: row.source_aweme_id,
    segments,
    hooks: parseJsonArray<string>(row.hooks_json).map((item) => String(item).trim()).filter(Boolean),
    ctaOptions: parseJsonArray<string>(row.cta_options_json)
      .map((item) => String(item).trim())
      .filter(Boolean),
    commentInsights: parseJsonArray<string>(row.comment_insights_json)
      .map((item) => String(item).trim())
      .filter(Boolean),
    fullScriptText: row.full_script_text || buildFullScriptText(segments),
    error: row.error,
  }
}

export interface WorkshopScriptDraft {
  title: string
  status?: WorkshopScriptStatus
  sourceResearchVideoId?: string | null
  sourceAwemeId?: string | null
  sourceTitle?: string | null
  topicId?: string | null
  topicTitle?: string
  videoType?: string
  angle?: string
  durationHintSec?: number
  summary?: string
  segments?: WorkshopScriptSegment[]
  hooks?: string[]
  ctaOptions?: string[]
  commentInsights?: string[]
  error?: string | null
}

export interface WorkshopRepository {
  listScripts: () => WorkshopScriptSummary[]
  getScript: (id: string) => WorkshopScriptDetail
  createScript: (draft: WorkshopScriptDraft) => WorkshopScriptDetail
  updateScript: (input: WorkshopScriptUpdateInput) => WorkshopScriptDetail
  updateStatus: (
    id: string,
    patch: {
      status?: WorkshopScriptStatus
      error?: string | null
      title?: string
      angle?: string
      summary?: string
      durationHintSec?: number
      segments?: WorkshopScriptSegment[]
      hooks?: string[]
      ctaOptions?: string[]
      commentInsights?: string[]
    },
  ) => WorkshopScriptDetail
  deleteScript: (id: string) => void
  findLatestBySource: (researchVideoId: string) => WorkshopScriptDetail | null
}

export function createWorkshopRepository(db: Database.Database): WorkshopRepository {
  const selectOne = db.prepare(`SELECT * FROM workshop_scripts WHERE id = ?`)

  return {
    listScripts: () => {
      const rows = db
        .prepare(
          `SELECT * FROM workshop_scripts
           ORDER BY updated_at DESC`,
        )
        .all() as ScriptRow[]
      return rows.map(mapSummary)
    },

    getScript: (id) => {
      const row = selectOne.get(id) as ScriptRow | undefined
      if (!row) throw new Error('脚本不存在')
      return mapDetail(row)
    },

    createScript: (draft) => {
      const id = randomUUID()
      const stamp = nowIso()
      const segments = draft.segments ?? []
      db.prepare(
        `INSERT INTO workshop_scripts
         (id, title, status, source_research_video_id, source_aweme_id, source_title,
          topic_id, topic_title, video_type, angle, duration_hint_sec, summary,
          segments_json, hooks_json, cta_options_json, comment_insights_json,
          full_script_text, error, created_at, updated_at)
         VALUES
         (@id, @title, @status, @sourceResearchVideoId, @sourceAwemeId, @sourceTitle,
          @topicId, @topicTitle, @videoType, @angle, @durationHintSec, @summary,
          @segmentsJson, @hooksJson, @ctaOptionsJson, @commentInsightsJson,
          @fullScriptText, @error, @createdAt, @updatedAt)`,
      ).run({
        id,
        title: draft.title.trim() || '未命名脚本',
        status: draft.status ?? 'draft',
        sourceResearchVideoId: draft.sourceResearchVideoId ?? null,
        sourceAwemeId: draft.sourceAwemeId ?? null,
        sourceTitle: draft.sourceTitle ?? null,
        topicId: draft.topicId ?? null,
        topicTitle: draft.topicTitle ?? '',
        videoType: draft.videoType ?? '其他',
        angle: draft.angle ?? '',
        durationHintSec: draft.durationHintSec ?? 0,
        summary: draft.summary ?? '',
        segmentsJson: JSON.stringify(segments),
        hooksJson: JSON.stringify(draft.hooks ?? []),
        ctaOptionsJson: JSON.stringify(draft.ctaOptions ?? []),
        commentInsightsJson: JSON.stringify(draft.commentInsights ?? []),
        fullScriptText: buildFullScriptText(segments),
        error: draft.error ?? null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      return mapDetail(selectOne.get(id) as ScriptRow)
    },

    updateScript: (input) => {
      const current = selectOne.get(input.id) as ScriptRow | undefined
      if (!current) throw new Error('脚本不存在')
      const detail = mapDetail(current)
      const segments = input.segments ?? detail.segments
      const stamp = nowIso()
      db.prepare(
        `UPDATE workshop_scripts
         SET title = @title,
             angle = @angle,
             summary = @summary,
             segments_json = @segmentsJson,
             hooks_json = @hooksJson,
             cta_options_json = @ctaOptionsJson,
             comment_insights_json = @commentInsightsJson,
             full_script_text = @fullScriptText,
             updated_at = @updatedAt
         WHERE id = @id`,
      ).run({
        id: input.id,
        title: (input.title ?? detail.title).trim() || detail.title,
        angle: input.angle ?? detail.angle,
        summary: input.summary ?? detail.summary,
        segmentsJson: JSON.stringify(segments),
        hooksJson: JSON.stringify(input.hooks ?? detail.hooks),
        ctaOptionsJson: JSON.stringify(input.ctaOptions ?? detail.ctaOptions),
        commentInsightsJson: JSON.stringify(input.commentInsights ?? detail.commentInsights),
        fullScriptText: buildFullScriptText(segments),
        updatedAt: stamp,
      })
      return mapDetail(selectOne.get(input.id) as ScriptRow)
    },

    updateStatus: (id, patch) => {
      const current = selectOne.get(id) as ScriptRow | undefined
      if (!current) throw new Error('脚本不存在')
      const detail = mapDetail(current)
      const segments = patch.segments ?? detail.segments
      const stamp = nowIso()
      db.prepare(
        `UPDATE workshop_scripts
         SET status = COALESCE(@status, status),
             error = CASE
               WHEN @clearError = 1 THEN NULL
               WHEN @error IS NOT NULL THEN @error
               ELSE error
             END,
             title = COALESCE(@title, title),
             angle = COALESCE(@angle, angle),
             summary = COALESCE(@summary, summary),
             duration_hint_sec = CASE WHEN @durationHintSec > 0 THEN @durationHintSec ELSE duration_hint_sec END,
             segments_json = COALESCE(@segmentsJson, segments_json),
             hooks_json = COALESCE(@hooksJson, hooks_json),
             cta_options_json = COALESCE(@ctaOptionsJson, cta_options_json),
             comment_insights_json = COALESCE(@commentInsightsJson, comment_insights_json),
             full_script_text = COALESCE(@fullScriptText, full_script_text),
             updated_at = @updatedAt
         WHERE id = @id`,
      ).run({
        id,
        status: patch.status ?? null,
        error: patch.error ?? null,
        clearError: patch.error === null ? 1 : 0,
        title: patch.title?.trim() ? patch.title.trim() : null,
        angle: patch.angle ?? null,
        summary: patch.summary ?? null,
        durationHintSec: patch.durationHintSec ?? 0,
        segmentsJson: patch.segments ? JSON.stringify(segments) : null,
        hooksJson: patch.hooks ? JSON.stringify(patch.hooks) : null,
        ctaOptionsJson: patch.ctaOptions ? JSON.stringify(patch.ctaOptions) : null,
        commentInsightsJson: patch.commentInsights ? JSON.stringify(patch.commentInsights) : null,
        fullScriptText: patch.segments ? buildFullScriptText(segments) : null,
        updatedAt: stamp,
      })
      return mapDetail(selectOne.get(id) as ScriptRow)
    },

    deleteScript: (id) => {
      const result = db.prepare(`DELETE FROM workshop_scripts WHERE id = ?`).run(id)
      if (result.changes === 0) throw new Error('脚本不存在')
    },

    findLatestBySource: (researchVideoId) => {
      const row = db
        .prepare(
          `SELECT * FROM workshop_scripts
           WHERE source_research_video_id = ?
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .get(researchVideoId) as ScriptRow | undefined
      return row ? mapDetail(row) : null
    },
  }
}
