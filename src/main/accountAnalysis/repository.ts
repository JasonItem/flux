import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type {
  AccountAnalysisDetail,
  AccountAnalysisDiagnosis,
  AccountAnalysisMetrics,
  AccountAnalysisStatus,
  AccountAnalysisVideoRow,
  AccountPortraitBundle,
  AccountTopicPlan,
  AccountVideoAnalysis,
  AccountWorkCollection,
} from '../../shared/accountAnalysis'

interface AnalysisRow {
  id: string
  account_id: string
  status: string
  diagnosis_json: string | null
  metrics_json: string | null
  videos_json: string
  source: string
  error: string | null
  created_at: string
  updated_at: string
  account_nickname?: string
  account_avatar_url?: string | null
}

/** 落在 diagnosis_json 里的扩展载荷 */
interface InsightsPayload {
  diagnosis: AccountAnalysisDiagnosis | null
  portrait: AccountPortraitBundle | null
  collections: AccountWorkCollection[]
  topicPlans: AccountTopicPlan[]
  videoAnalyses: Record<string, AccountVideoAnalysis>
}

export interface AccountAnalysisSaveInput {
  accountId: string
  status: AccountAnalysisStatus
  diagnosis: AccountAnalysisDiagnosis | null
  portrait: AccountPortraitBundle | null
  collections: AccountWorkCollection[]
  topicPlans: AccountTopicPlan[]
  metrics: AccountAnalysisMetrics | null
  videos: AccountAnalysisVideoRow[]
  videoAnalyses?: Record<string, AccountVideoAnalysis>
  source: 'llm' | 'fallback'
  error?: string | null
}

function nowIso(): string {
  return new Date().toISOString()
}

function emptyPortrait(): AccountPortraitBundle {
  return {
    audience: {
      summary: '',
      gender: [],
      age: [],
      interests: [],
      motivations: [],
      activeTraits: [],
    },
    fans: {
      summary: '',
      gender: [],
      age: [],
      interests: [],
      motivations: [],
      activeTraits: [],
    },
    note: '基于公开作品与评论的推断，非创作者中心官方画像。',
  }
}

function parsePortrait(raw: unknown): AccountPortraitBundle | null {
  if (!raw || typeof raw !== 'object') return null
  const parsed = raw as AccountPortraitBundle
  const base = emptyPortrait()
  return {
    note: parsed.note || base.note,
    audience: {
      summary: parsed.audience?.summary || '',
      gender: Array.isArray(parsed.audience?.gender) ? parsed.audience.gender : [],
      age: Array.isArray(parsed.audience?.age) ? parsed.audience.age : [],
      interests: Array.isArray(parsed.audience?.interests) ? parsed.audience.interests : [],
      motivations: Array.isArray(parsed.audience?.motivations) ? parsed.audience.motivations : [],
      activeTraits: Array.isArray(parsed.audience?.activeTraits)
        ? parsed.audience.activeTraits
        : [],
    },
    fans: {
      summary: parsed.fans?.summary || '',
      gender: Array.isArray(parsed.fans?.gender) ? parsed.fans.gender : [],
      age: Array.isArray(parsed.fans?.age) ? parsed.fans.age : [],
      interests: Array.isArray(parsed.fans?.interests) ? parsed.fans.interests : [],
      motivations: Array.isArray(parsed.fans?.motivations) ? parsed.fans.motivations : [],
      activeTraits: Array.isArray(parsed.fans?.activeTraits) ? parsed.fans.activeTraits : [],
    },
  }
}

function parseDiagnosisLegacy(parsed: Record<string, unknown>): AccountAnalysisDiagnosis | null {
  if (!parsed.stageLabel && !parsed.positioning) return null
  return {
    stageLabel: String(parsed.stageLabel || '待评估'),
    positioning: String(parsed.positioning || ''),
    strengths: Array.isArray(parsed.strengths) ? (parsed.strengths as string[]) : [],
    weaknesses: Array.isArray(parsed.weaknesses) ? (parsed.weaknesses as string[]) : [],
    postingCadence: String(parsed.postingCadence || ''),
    durationInsight: String(parsed.durationInsight || ''),
    trackAlignment: (parsed.trackAlignment as string | null) ?? null,
  }
}

function normalizeVideoAnalyses(raw: unknown): Record<string, AccountVideoAnalysis> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, AccountVideoAnalysis> = {}
  for (const [awemeId, value] of Object.entries(raw as Record<string, AccountVideoAnalysis>)) {
    if (!value || typeof value !== 'object') continue
    out[awemeId] = {
      ...value,
      comments: Array.isArray(value.comments) ? value.comments : [],
      sampleCommentCount:
        typeof value.sampleCommentCount === 'number'
          ? value.sampleCommentCount
          : Array.isArray(value.comments)
            ? value.comments.length
            : 0,
    }
  }
  return out
}

function parseInsights(raw: string | null): InsightsPayload {
  const empty: InsightsPayload = {
    diagnosis: null,
    portrait: null,
    collections: [],
    topicPlans: [],
    videoAnalyses: {},
  }
  if (!raw) return empty
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // 新结构：带 portrait / collections
    if (parsed.portrait || parsed.collections || parsed.topicPlans || parsed.diagnosis) {
      return {
        diagnosis:
          parsed.diagnosis && typeof parsed.diagnosis === 'object'
            ? parseDiagnosisLegacy(parsed.diagnosis as Record<string, unknown>)
            : parseDiagnosisLegacy(parsed),
        portrait: parsePortrait(parsed.portrait),
        collections: Array.isArray(parsed.collections)
          ? (parsed.collections as AccountWorkCollection[])
          : [],
        topicPlans: Array.isArray(parsed.topicPlans)
          ? (parsed.topicPlans as AccountTopicPlan[])
          : [],
        videoAnalyses: normalizeVideoAnalyses(parsed.videoAnalyses),
      }
    }
    // 旧结构：纯 diagnosis
    return {
      ...empty,
      diagnosis: parseDiagnosisLegacy(parsed),
    }
  } catch {
    return empty
  }
}

function parseMetrics(raw: string | null): AccountAnalysisMetrics | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as AccountAnalysisMetrics
  } catch {
    return null
  }
}

function parseVideos(raw: string): AccountAnalysisVideoRow[] {
  try {
    const parsed = JSON.parse(raw) as AccountAnalysisVideoRow[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => ({
      ...item,
      collectionId: item.collectionId ?? null,
    }))
  } catch {
    return []
  }
}

function mapDetail(row: AnalysisRow): AccountAnalysisDetail {
  const insights = parseInsights(row.diagnosis_json)
  return {
    id: row.id,
    accountId: row.account_id,
    accountNickname: row.account_nickname || '未知账号',
    accountAvatarUrl: row.account_avatar_url ?? null,
    status: (row.status as AccountAnalysisStatus) || 'pending',
    diagnosis: insights.diagnosis,
    portrait: insights.portrait,
    collections: insights.collections,
    topicPlans: insights.topicPlans,
    metrics: parseMetrics(row.metrics_json),
    videos: parseVideos(row.videos_json),
    videoAnalyses: insights.videoAnalyses,
    source: row.source === 'llm' ? 'llm' : 'fallback',
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const selectJoined = `
  SELECT a.*, d.nickname AS account_nickname, d.avatar_url AS account_avatar_url
  FROM account_analyses a
  LEFT JOIN douyin_accounts d ON d.id = a.account_id
`

export interface AccountAnalysisRepository {
  getByAccountId: (accountId: string) => AccountAnalysisDetail | null
  getReadyByAccountId: (accountId: string) => AccountAnalysisDetail | null
  upsert: (input: AccountAnalysisSaveInput) => AccountAnalysisDetail
  patchVideoAnalysis: (
    accountId: string,
    analysis: AccountVideoAnalysis,
  ) => AccountAnalysisDetail
}

export function createAccountAnalysisRepository(
  db: Database.Database,
): AccountAnalysisRepository {
  return {
    getByAccountId: (accountId) => {
      const row = db
        .prepare(`${selectJoined} WHERE a.account_id = ?`)
        .get(accountId) as AnalysisRow | undefined
      return row ? mapDetail(row) : null
    },

    getReadyByAccountId: (accountId) => {
      const row = db
        .prepare(`${selectJoined} WHERE a.account_id = ? AND a.status = 'ready'`)
        .get(accountId) as AnalysisRow | undefined
      return row ? mapDetail(row) : null
    },

    upsert: (input) => {
      const stamp = nowIso()
      const existing = db
        .prepare(`SELECT id, created_at, diagnosis_json FROM account_analyses WHERE account_id = ?`)
        .get(input.accountId) as
        | { id: string; created_at: string; diagnosis_json: string | null }
        | undefined
      const id = existing?.id ?? randomUUID()
      const createdAt = existing?.created_at ?? stamp
      const prevInsights = parseInsights(existing?.diagnosis_json ?? null)
      const videoAnalyses = input.videoAnalyses ?? prevInsights.videoAnalyses

      const insights: InsightsPayload = {
        diagnosis: input.diagnosis,
        portrait: input.portrait,
        collections: input.collections,
        topicPlans: input.topicPlans,
        videoAnalyses,
      }

      db.prepare(
        `INSERT INTO account_analyses
         (id, account_id, status, diagnosis_json, metrics_json, videos_json, source, error, created_at, updated_at)
         VALUES
         (@id, @accountId, @status, @diagnosisJson, @metricsJson, @videosJson, @source, @error, @createdAt, @updatedAt)
         ON CONFLICT(account_id) DO UPDATE SET
           status = excluded.status,
           diagnosis_json = excluded.diagnosis_json,
           metrics_json = excluded.metrics_json,
           videos_json = excluded.videos_json,
           source = excluded.source,
           error = excluded.error,
           updated_at = excluded.updated_at`,
      ).run({
        id,
        accountId: input.accountId,
        status: input.status,
        diagnosisJson: JSON.stringify(insights),
        metricsJson: input.metrics ? JSON.stringify(input.metrics) : null,
        videosJson: JSON.stringify(input.videos),
        source: input.source,
        error: input.error ?? null,
        createdAt,
        updatedAt: stamp,
      })

      const row = db
        .prepare(`${selectJoined} WHERE a.account_id = ?`)
        .get(input.accountId) as AnalysisRow | undefined
      if (!row) throw new Error('保存账号分析失败')
      return mapDetail(row)
    },

    patchVideoAnalysis: (accountId, analysis) => {
      const current = db
        .prepare(`${selectJoined} WHERE a.account_id = ?`)
        .get(accountId) as AnalysisRow | undefined
      if (!current || current.status !== 'ready') {
        throw new Error('请先完成账号分析')
      }
      const insights = parseInsights(current.diagnosis_json)
      insights.videoAnalyses = {
        ...insights.videoAnalyses,
        [analysis.awemeId]: analysis,
      }
      const stamp = nowIso()
      db.prepare(
        `UPDATE account_analyses
         SET diagnosis_json = @diagnosisJson, updated_at = @updatedAt
         WHERE account_id = @accountId`,
      ).run({
        accountId,
        diagnosisJson: JSON.stringify(insights),
        updatedAt: stamp,
      })
      const row = db
        .prepare(`${selectJoined} WHERE a.account_id = ?`)
        .get(accountId) as AnalysisRow | undefined
      if (!row) throw new Error('保存单视频分析失败')
      return mapDetail(row)
    },
  }
}
