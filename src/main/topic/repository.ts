import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type {
  TopicItem,
  TopicManualInput,
  TopicStatus,
  TopicUpdateInput,
} from '../../shared/topic'

interface TopicRow {
  id: string
  account_id: string
  assessment_id: string | null
  candidate_id: string | null
  title: string
  summary: string
  domain: string
  heat_score: number | null
  competition_score: number | null
  potential_score: number | null
  reason: string
  source: string
  status: string
  created_at: string
  updated_at: string
  account_nickname?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function mapTopic(row: TopicRow): TopicItem {
  return {
    id: row.id,
    accountId: row.account_id,
    accountNickname: row.account_nickname || '未知账号',
    assessmentId: row.assessment_id,
    candidateId: row.candidate_id,
    title: row.title?.trim() || '未命名选题',
    summary: row.summary || '',
    domain: row.domain || '',
    heatScore: row.heat_score,
    competitionScore: row.competition_score,
    potentialScore: row.potential_score,
    reason: row.reason,
    source: row.source === 'manual' ? 'manual' : 'track',
    status: row.status as TopicStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface TopicFromTrackInput {
  accountId: string
  assessmentId: string
  candidateId: string
  title: string
  summary: string
  domain: string
  heatScore: number
  competitionScore: number
  potentialScore: number
  reason: string
}

export interface TopicRepository {
  list: (accountId?: string) => TopicItem[]
  getById: (id: string) => TopicItem
  findByCandidateId: (candidateId: string) => TopicItem | null
  listCandidateIds: (candidateIds: string[]) => Set<string>
  addFromTrack: (input: TopicFromTrackInput) => TopicItem
  addManual: (input: TopicManualInput) => TopicItem
  update: (input: TopicUpdateInput) => TopicItem
  delete: (id: string) => void
}

export function createTopicRepository(db: Database.Database): TopicRepository {
  const selectJoined = db.prepare(
    `SELECT t.*, d.nickname AS account_nickname
     FROM topics t
     LEFT JOIN douyin_accounts d ON d.id = t.account_id
     WHERE t.id = ?`,
  )

  function requireTopic(id: string): TopicItem {
    const row = selectJoined.get(id) as TopicRow | undefined
    if (!row) throw new Error('选题不存在')
    return mapTopic(row)
  }

  return {
    list: (accountId) => {
      const rows = (
        accountId
          ? db
              .prepare(
                `SELECT t.*, d.nickname AS account_nickname
                 FROM topics t
                 LEFT JOIN douyin_accounts d ON d.id = t.account_id
                 WHERE t.account_id = ?
                 ORDER BY t.updated_at DESC`,
              )
              .all(accountId)
          : db
              .prepare(
                `SELECT t.*, d.nickname AS account_nickname
                 FROM topics t
                 LEFT JOIN douyin_accounts d ON d.id = t.account_id
                 ORDER BY t.updated_at DESC`,
              )
              .all()
      ) as TopicRow[]
      return rows.map(mapTopic)
    },

    getById: (id) => requireTopic(id),

    findByCandidateId: (candidateId) => {
      const row = db
        .prepare(
          `SELECT t.*, d.nickname AS account_nickname
           FROM topics t
           LEFT JOIN douyin_accounts d ON d.id = t.account_id
           WHERE t.candidate_id = ?`,
        )
        .get(candidateId) as TopicRow | undefined
      return row ? mapTopic(row) : null
    },

    listCandidateIds: (candidateIds) => {
      if (candidateIds.length === 0) return new Set()
      const placeholders = candidateIds.map(() => '?').join(',')
      const rows = db
        .prepare(
          `SELECT candidate_id FROM topics
           WHERE candidate_id IN (${placeholders})`,
        )
        .all(...candidateIds) as Array<{ candidate_id: string }>
      return new Set(rows.map((row) => row.candidate_id))
    },

    addFromTrack: (input) => {
      const existing = db
        .prepare(`SELECT id FROM topics WHERE candidate_id = ?`)
        .get(input.candidateId) as { id: string } | undefined
      if (existing) return requireTopic(existing.id)

      const id = randomUUID()
      const stamp = nowIso()
      db.prepare(
        `INSERT INTO topics
         (id, account_id, assessment_id, candidate_id, title, summary, domain,
          heat_score, competition_score, potential_score, reason, source, status, created_at, updated_at)
         VALUES
         (@id, @accountId, @assessmentId, @candidateId, @title, @summary, @domain,
          @heatScore, @competitionScore, @potentialScore, @reason, 'track', 'inbox', @createdAt, @updatedAt)`,
      ).run({
        id,
        accountId: input.accountId,
        assessmentId: input.assessmentId,
        candidateId: input.candidateId,
        title: input.title,
        summary: input.summary,
        domain: input.domain,
        heatScore: input.heatScore,
        competitionScore: input.competitionScore,
        potentialScore: input.potentialScore,
        reason: input.reason,
        createdAt: stamp,
        updatedAt: stamp,
      })
      return requireTopic(id)
    },

    addManual: (input) => {
      const title = input.title.trim()
      if (!title) throw new Error('选题标题不能为空')
      const id = randomUUID()
      const stamp = nowIso()
      db.prepare(
        `INSERT INTO topics
         (id, account_id, assessment_id, candidate_id, title, summary, domain,
          heat_score, competition_score, potential_score, reason, source, status, created_at, updated_at)
         VALUES
         (@id, @accountId, NULL, NULL, @title, @summary, @domain,
          NULL, NULL, NULL, @reason, 'manual', 'inbox', @createdAt, @updatedAt)`,
      ).run({
        id,
        accountId: input.accountId,
        title,
        summary: input.summary?.trim() || '',
        domain: input.domain?.trim() || title,
        reason: input.reason?.trim() || '来自账号分析选题方案',
        createdAt: stamp,
        updatedAt: stamp,
      })
      return requireTopic(id)
    },

    update: (input) => {
      const current = requireTopic(input.id)
      const stamp = nowIso()
      db.prepare(
        `UPDATE topics
         SET title = @title, summary = @summary, status = @status, updated_at = @updatedAt
         WHERE id = @id`,
      ).run({
        id: input.id,
        title: input.title?.trim() || current.title,
        summary: input.summary ?? current.summary,
        status: input.status ?? current.status,
        updatedAt: stamp,
      })
      return requireTopic(input.id)
    },

    delete: (id) => {
      requireTopic(id)
      const apply = db.transaction(() => {
        db.prepare(`DELETE FROM research_videos WHERE topic_id = ?`).run(id)
        db.prepare(`DELETE FROM topics WHERE id = ?`).run(id)
      })
      apply()
    },
  }
}
