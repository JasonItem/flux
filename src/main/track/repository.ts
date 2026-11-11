import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type {
  TrackAssessment,
  TrackAssessmentStatus,
  TrackAssessmentSummary,
  TrackCandidate,
  TrackDiagnosis,
  TrackInfluencer,
  TrackMarketMetrics,
} from '../../shared/track'

interface AssessmentRow {
  id: string
  account_id: string
  status: string
  diagnosis_json: string | null
  selected_candidate_id: string | null
  error: string | null
  created_at: string
  updated_at: string
  account_nickname?: string
  account_avatar_url?: string | null
  candidate_count?: number
}

interface CandidateRow {
  id: string
  assessment_id: string
  name: string
  summary: string
  heat_score: number
  competition_score: number
  potential_score: number
  reason: string
  influencers_json: string
  sort_order: number
  created_at: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function parseDiagnosis(raw: string | null): TrackDiagnosis | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as TrackDiagnosis & {
      contentDistribution?: string[]
    }
    if (!parsed.composition && Array.isArray(parsed.contentDistribution)) {
      parsed.composition = parsed.contentDistribution.map((label, _index, arr) => ({
        label,
        share: Math.round(100 / Math.max(arr.length, 1)),
        signal: label,
      }))
    }
    return {
      positioning: parsed.positioning || '',
      composition: parsed.composition || [],
      strengths: parsed.strengths || [],
      weaknesses: parsed.weaknesses || [],
    }
  } catch {
    return null
  }
}

function isFakeInfluencer(item: Partial<TrackInfluencer>): boolean {
  const uniqueId = item.uniqueId ?? ''
  const nickname = item.nickname ?? ''
  if (/^cb_\d+_/i.test(uniqueId)) return true
  if (/观察员$|实战派$/.test(nickname) && /^cb_/i.test(uniqueId)) return true
  if ((item.avatarUrl ?? '').includes('dicebear.com')) return true
  if (!uniqueId && (item.followerCount ?? 0) <= 0 && (item.awemeCount ?? 0) <= 0) {
    if (/观察员|实战派|对标·|样本号/.test(nickname)) return true
  }
  return false
}

function parseInfluencers(raw: string): TrackInfluencer[] {
  try {
    const value = JSON.parse(raw) as Array<Partial<TrackInfluencer>>
    if (!Array.isArray(value)) return []
    return value
      .filter((item) => !isFakeInfluencer(item))
      .map((item) => {
        const uniqueId = item.uniqueId ?? null
        const nickname = item.nickname || '未知红人'
        return {
          nickname,
          uniqueId,
          avatarUrl: item.avatarUrl ?? null,
          signature: item.signature ?? item.highlight ?? null,
          followerCount: item.followerCount ?? 0,
          awemeCount: item.awemeCount ?? 0,
          highlight: item.highlight || '',
          profileUrl:
            item.profileUrl ||
            (uniqueId
              ? `https://www.douyin.com/search/${encodeURIComponent(uniqueId)}`
              : `https://www.douyin.com/search/${encodeURIComponent(nickname)}`),
        }
      })
  } catch {
    return []
  }
}

function parseEvidence(reason: string, influencersJson: string): string[] {
  try {
    const payload = JSON.parse(influencersJson) as { __evidence?: string[] }
    if (Array.isArray(payload?.__evidence)) return payload.__evidence
  } catch {
    // influencers_json is array in normal cases
  }
  return reason ? [reason] : []
}

export interface TrackCandidateInsert {
  name: string
  summary: string
  heatScore: number
  competitionScore: number
  potentialScore: number
  metrics?: TrackMarketMetrics | null
  reason: string
  evidence: string[]
  influencers: TrackInfluencer[]
  sortOrder: number
  /** 仅内存使用：短检索词，不单独落库 */
  searchHint?: string | null
}

function parseMetrics(raw: unknown): TrackMarketMetrics | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const avgPlayCount = Number(row.avgPlayCount ?? 0)
  const totalPlayCount = Number(row.totalPlayCount ?? 0)
  const sampleVideoCount = Number(row.sampleVideoCount ?? 0)
  const creatorCount = Number(row.creatorCount ?? 0)
  const playPerCreator = Number(row.playPerCreator ?? 0)
  const avgDiggCount = Number(row.avgDiggCount ?? 0)
  const potentialScore = Number(row.potentialScore ?? 0)
  if (
    ![avgPlayCount, totalPlayCount, sampleVideoCount, creatorCount, playPerCreator].some(
      (n) => Number.isFinite(n) && n > 0,
    )
  ) {
    return null
  }
  return {
    avgPlayCount: Math.max(0, Math.round(avgPlayCount)),
    totalPlayCount: Math.max(0, Math.round(totalPlayCount)),
    sampleVideoCount: Math.max(0, Math.round(sampleVideoCount)),
    creatorCount: Math.max(0, Math.round(creatorCount)),
    playPerCreator: Math.max(0, Math.round(playPerCreator)),
    avgDiggCount: Math.max(0, Math.round(avgDiggCount)),
    potentialScore: Math.max(1, Math.min(100, Math.round(potentialScore || 1))),
  }
}

export interface TrackRepository {
  listSummaries: (accountId?: string) => TrackAssessmentSummary[]
  getAssessment: (id: string, addedCandidateIds?: Set<string>) => TrackAssessment
  createRunning: (accountId: string) => TrackAssessment
  markFailed: (id: string, error: string) => TrackAssessment
  markReady: (
    id: string,
    diagnosis: TrackDiagnosis,
    candidates: TrackCandidateInsert[],
  ) => TrackAssessment
  updateCandidateMarket: (
    candidateId: string,
    patch: Pick<
      TrackCandidateInsert,
      | 'heatScore'
      | 'competitionScore'
      | 'potentialScore'
      | 'metrics'
      | 'reason'
      | 'evidence'
      | 'influencers'
    >,
  ) => void
  getCandidate: (
    assessmentId: string,
    candidateId: string,
  ) => { assessmentAccountId: string; candidate: TrackCandidateInsert & { id: string } }
  deleteAssessment: (id: string) => void
}

export function createTrackRepository(db: Database.Database): TrackRepository {
  const selectAssessment = db.prepare(
    `SELECT a.id, a.account_id, a.status, a.diagnosis_json, a.selected_candidate_id,
            a.error, a.created_at, a.updated_at,
            d.nickname AS account_nickname, d.avatar_url AS account_avatar_url
     FROM track_assessments a
     LEFT JOIN douyin_accounts d ON d.id = a.account_id
     WHERE a.id = ?`,
  )

  const selectCandidates = db.prepare(
    `SELECT id, assessment_id, name, summary, heat_score, competition_score, potential_score,
            reason, influencers_json, sort_order, created_at
     FROM track_candidates
     WHERE assessment_id = ?
     ORDER BY sort_order ASC`,
  )

  function requireAssessment(id: string): AssessmentRow {
    const row = selectAssessment.get(id) as AssessmentRow | undefined
    if (!row) throw new Error('自测记录不存在')
    return row
  }

  function mapCandidate(row: CandidateRow, added: Set<string>): TrackCandidate {
    let evidence: string[] = []
    let influencers = parseInfluencers(row.influencers_json)
    let metrics: TrackMarketMetrics | null = null
    try {
      const wrapper = JSON.parse(row.influencers_json) as {
        influencers?: TrackInfluencer[]
        evidence?: string[]
        metrics?: unknown
      }
      if (wrapper && Array.isArray(wrapper.influencers)) {
        influencers = parseInfluencers(JSON.stringify(wrapper.influencers)).filter(
          (item) => !isFakeInfluencer(item),
        )
        evidence = Array.isArray(wrapper.evidence) ? wrapper.evidence : []
        metrics = parseMetrics(wrapper.metrics)
      }
    } catch {
      evidence = parseEvidence(row.reason, row.influencers_json)
    }

    if (!metrics) {
      // 兼容旧数据：用三列分数兜底成可读指标
      metrics = {
        avgPlayCount: Math.max(0, row.heat_score),
        totalPlayCount: Math.max(0, row.heat_score),
        sampleVideoCount: 0,
        creatorCount: 0,
        playPerCreator: Math.max(0, row.competition_score),
        avgDiggCount: 0,
        potentialScore: Math.max(1, Math.min(100, row.potential_score || 1)),
      }
    }

    return {
      id: row.id,
      assessmentId: row.assessment_id,
      name: row.name,
      summary: row.summary,
      heatScore: row.heat_score,
      competitionScore: row.competition_score,
      potentialScore: metrics.potentialScore,
      metrics,
      reason: row.reason,
      evidence,
      influencers,
      sortOrder: row.sort_order,
      addedAsTopic: added.has(row.id),
    }
  }

  function mapAssessment(row: AssessmentRow, added: Set<string>): TrackAssessment {
    const status = row.status === 'selected' ? 'ready' : (row.status as TrackAssessmentStatus)
    return {
      id: row.id,
      accountId: row.account_id,
      accountNickname: row.account_nickname || '未知账号',
      accountAvatarUrl: row.account_avatar_url ?? null,
      status: status === 'running' || status === 'failed' || status === 'ready' ? status : 'ready',
      diagnosis: parseDiagnosis(row.diagnosis_json),
      candidates: (selectCandidates.all(row.id) as CandidateRow[]).map((item) =>
        mapCandidate(item, added),
      ),
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  return {
    listSummaries: (accountId) => {
      const rows = (
        accountId
          ? db
              .prepare(
                `SELECT a.id, a.account_id, a.status, a.created_at, a.updated_at,
                        d.nickname AS account_nickname,
                        (SELECT COUNT(*) FROM track_candidates c WHERE c.assessment_id = a.id) AS candidate_count
                 FROM track_assessments a
                 LEFT JOIN douyin_accounts d ON d.id = a.account_id
                 WHERE a.account_id = ?
                 ORDER BY a.updated_at DESC`,
              )
              .all(accountId)
          : db
              .prepare(
                `SELECT a.id, a.account_id, a.status, a.created_at, a.updated_at,
                        d.nickname AS account_nickname,
                        (SELECT COUNT(*) FROM track_candidates c WHERE c.assessment_id = a.id) AS candidate_count
                 FROM track_assessments a
                 LEFT JOIN douyin_accounts d ON d.id = a.account_id
                 ORDER BY a.updated_at DESC`,
              )
              .all()
      ) as AssessmentRow[]

      return rows.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        accountNickname: row.account_nickname || '未知账号',
        status:
          row.status === 'running' || row.status === 'failed'
            ? (row.status as TrackAssessmentStatus)
            : 'ready',
        candidateCount: Number(row.candidate_count ?? 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
    },

    getAssessment: (id, addedCandidateIds) =>
      mapAssessment(requireAssessment(id), addedCandidateIds ?? new Set()),

    createRunning: (accountId) => {
      const id = randomUUID()
      const stamp = nowIso()
      db.prepare(
        `INSERT INTO track_assessments
         (id, account_id, status, diagnosis_json, selected_candidate_id, error, created_at, updated_at)
         VALUES (@id, @accountId, 'running', NULL, NULL, NULL, @createdAt, @updatedAt)`,
      ).run({ id, accountId, createdAt: stamp, updatedAt: stamp })
      return mapAssessment(requireAssessment(id), new Set())
    },

    markFailed: (id, error) => {
      requireAssessment(id)
      db.prepare(
        `UPDATE track_assessments
         SET status = 'failed', error = @error, updated_at = @updatedAt
         WHERE id = @id`,
      ).run({ id, error, updatedAt: nowIso() })
      return mapAssessment(requireAssessment(id), new Set())
    },

    markReady: (id, diagnosis, candidates) => {
      requireAssessment(id)
      const stamp = nowIso()
      const apply = db.transaction(() => {
        db.prepare(`DELETE FROM track_candidates WHERE assessment_id = ?`).run(id)
        const insert = db.prepare(
          `INSERT INTO track_candidates
           (id, assessment_id, name, summary, heat_score, competition_score, potential_score,
            reason, influencers_json, sort_order, created_at)
           VALUES
           (@id, @assessmentId, @name, @summary, @heatScore, @competitionScore, @potentialScore,
            @reason, @influencersJson, @sortOrder, @createdAt)`,
        )
        for (const candidate of candidates) {
          insert.run({
            id: randomUUID(),
            assessmentId: id,
            name: candidate.name,
            summary: candidate.summary,
            heatScore: candidate.heatScore,
            competitionScore: candidate.competitionScore,
            potentialScore: candidate.potentialScore,
            reason: candidate.reason,
            influencersJson: JSON.stringify({
              evidence: candidate.evidence,
              influencers: candidate.influencers,
              metrics: candidate.metrics ?? null,
            }),
            sortOrder: candidate.sortOrder,
            createdAt: stamp,
          })
        }
        db.prepare(
          `UPDATE track_assessments
           SET status = 'ready', diagnosis_json = @diagnosisJson, selected_candidate_id = NULL,
               error = NULL, updated_at = @updatedAt
           WHERE id = @id`,
        ).run({
          id,
          diagnosisJson: JSON.stringify(diagnosis),
          updatedAt: stamp,
        })
      })
      apply()
      return mapAssessment(requireAssessment(id), new Set())
    },

    updateCandidateMarket: (candidateId, patch) => {
      const row = db
        .prepare(`SELECT id FROM track_candidates WHERE id = ?`)
        .get(candidateId) as { id: string } | undefined
      if (!row) throw new Error('赛道候选不存在')
      db.prepare(
        `UPDATE track_candidates
         SET heat_score = @heatScore,
             competition_score = @competitionScore,
             potential_score = @potentialScore,
             reason = @reason,
             influencers_json = @influencersJson
         WHERE id = @id`,
      ).run({
        id: candidateId,
        heatScore: patch.heatScore,
        competitionScore: patch.competitionScore,
        potentialScore: patch.potentialScore,
        reason: patch.reason,
        influencersJson: JSON.stringify({
          evidence: patch.evidence,
          influencers: patch.influencers,
          metrics: patch.metrics ?? null,
        }),
      })
    },

    getCandidate: (assessmentId, candidateId) => {
      const assessment = requireAssessment(assessmentId)
      const row = (selectCandidates.all(assessmentId) as CandidateRow[]).find(
        (item) => item.id === candidateId,
      )
      if (!row) throw new Error('赛道候选不存在')
      const mapped = mapCandidate(row, new Set())
      return {
        assessmentAccountId: assessment.account_id,
        candidate: {
          id: mapped.id,
          name: mapped.name,
          summary: mapped.summary,
          heatScore: mapped.heatScore,
          competitionScore: mapped.competitionScore,
          potentialScore: mapped.potentialScore,
          metrics: mapped.metrics,
          reason: mapped.reason,
          evidence: mapped.evidence,
          influencers: mapped.influencers,
          sortOrder: mapped.sortOrder,
        },
      }
    },

    deleteAssessment: (id) => {
      requireAssessment(id)
      const apply = db.transaction(() => {
        db.prepare(`DELETE FROM track_candidates WHERE assessment_id = ?`).run(id)
        db.prepare(`DELETE FROM track_assessments WHERE id = ?`).run(id)
      })
      apply()
    },
  }
}
