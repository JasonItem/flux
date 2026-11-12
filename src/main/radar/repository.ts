import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type {
  RadarAccount,
  RadarRules,
  RadarRulesUpdateInput,
  RadarSignalFilter,
  RadarWork,
} from '../../shared/radar'

interface AccountRow {
  id: string
  sec_user_id: string
  uid: string | null
  unique_id: string | null
  nickname: string
  avatar_url: string | null
  signature: string | null
  follower_count: number
  aweme_count: number
  profile_url: string | null
  source_input: string
  enabled: number
  last_synced_at: string | null
  created_at: string
  updated_at: string
  work_count?: number
}

interface WorkRow {
  id: string
  aweme_id: string
  radar_account_id: string | null
  author_nickname: string
  author_unique_id: string | null
  title: string
  cover_url: string | null
  play_url: string | null
  profile_url: string | null
  digg_count: number
  comment_count: number
  share_count: number
  play_count: number
  duration_sec: number
  publish_at: string | null
  is_high: number
  is_new: number
  is_hot: number
  source: string
  first_seen_at: string
  updated_at: string
}

interface RulesRow {
  high_min_digg: number
  high_min_play: number
  new_within_hours: number
  hot_keywords: string
  auto_sync_enabled: number
  sync_interval_minutes: number
  updated_at: string
}

function mapAccount(row: AccountRow): RadarAccount {
  return {
    id: row.id,
    secUserId: row.sec_user_id,
    uid: row.uid,
    uniqueId: row.unique_id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    signature: row.signature,
    followerCount: row.follower_count,
    awemeCount: row.aweme_count,
    profileUrl: row.profile_url,
    sourceInput: row.source_input,
    enabled: Boolean(row.enabled),
    lastSyncedAt: row.last_synced_at,
    workCount: Number(row.work_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapWork(row: WorkRow): RadarWork {
  return {
    id: row.id,
    awemeId: row.aweme_id,
    radarAccountId: row.radar_account_id,
    authorNickname: row.author_nickname,
    authorUniqueId: row.author_unique_id,
    title: row.title,
    coverUrl: row.cover_url,
    playUrl: row.play_url,
    profileUrl: row.profile_url,
    diggCount: row.digg_count,
    commentCount: row.comment_count,
    shareCount: row.share_count,
    playCount: row.play_count,
    durationSec: row.duration_sec,
    publishAt: row.publish_at,
    isHigh: Boolean(row.is_high),
    isNew: Boolean(row.is_new),
    isHot: Boolean(row.is_hot),
    source: row.source === 'hot' ? 'hot' : 'account',
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
  }
}

function mapRules(row: RulesRow): RadarRules {
  return {
    highMinDigg: row.high_min_digg,
    highMinPlay: row.high_min_play,
    newWithinHours: row.new_within_hours,
    hotKeywords: row.hot_keywords,
    autoSyncEnabled: Boolean(row.auto_sync_enabled),
    syncIntervalMinutes: row.sync_interval_minutes,
    updatedAt: row.updated_at,
  }
}

export interface RadarWorkUpsertInput {
  awemeId: string
  radarAccountId: string | null
  authorNickname: string
  authorUniqueId: string | null
  title: string
  coverUrl: string | null
  playUrl: string | null
  profileUrl: string | null
  diggCount: number
  commentCount: number
  shareCount: number
  playCount: number
  durationSec: number
  publishAt: string | null
  isHigh: boolean
  isNew: boolean
  isHot: boolean
  source: 'account' | 'hot'
}

export interface RadarRepository {
  listAccounts: () => RadarAccount[]
  getAccount: (id: string) => RadarAccount
  findAccountBySecUserId: (secUserId: string) => RadarAccount | null
  upsertAccount: (input: {
    secUserId: string
    uid: string | null
    uniqueId: string | null
    nickname: string
    avatarUrl: string | null
    signature: string | null
    followerCount: number
    awemeCount: number
    profileUrl: string | null
    sourceInput: string
  }) => RadarAccount
  setAccountEnabled: (id: string, enabled: boolean) => RadarAccount
  markAccountSynced: (id: string) => RadarAccount
  removeAccount: (id: string) => void
  listWorks: (filter: RadarSignalFilter, limit: number) => RadarWork[]
  upsertWorks: (works: RadarWorkUpsertInput[]) => number
  reclassifyWorks: (rules: RadarRules) => void
  getRules: () => RadarRules
  updateRules: (input: RadarRulesUpdateInput) => RadarRules
}

export function createRadarRepository(db: Database.Database): RadarRepository {
  const ensureRules = () => {
    db.prepare(
      `INSERT INTO radar_rules (
         id, high_min_digg, high_min_play, new_within_hours, hot_keywords,
         auto_sync_enabled, sync_interval_minutes, updated_at
       ) VALUES (1, 10000, 0, 72, '', 0, 120, @updatedAt)
       ON CONFLICT(id) DO NOTHING`,
    ).run({ updatedAt: new Date().toISOString() })
  }

  return {
    listAccounts: () => {
      const rows = db
        .prepare(
          `SELECT a.*,
                  (SELECT COUNT(*) FROM radar_works w WHERE w.radar_account_id = a.id) AS work_count
           FROM radar_accounts a
           ORDER BY a.updated_at DESC`,
        )
        .all() as AccountRow[]
      return rows.map(mapAccount)
    },

    getAccount: (id) => {
      const row = db
        .prepare(
          `SELECT a.*,
                  (SELECT COUNT(*) FROM radar_works w WHERE w.radar_account_id = a.id) AS work_count
           FROM radar_accounts a WHERE a.id = ?`,
        )
        .get(id) as AccountRow | undefined
      if (!row) throw new Error('对标账号不存在')
      return mapAccount(row)
    },

    findAccountBySecUserId: (secUserId) => {
      const row = db
        .prepare(
          `SELECT a.*,
                  (SELECT COUNT(*) FROM radar_works w WHERE w.radar_account_id = a.id) AS work_count
           FROM radar_accounts a WHERE a.sec_user_id = ?`,
        )
        .get(secUserId) as AccountRow | undefined
      return row ? mapAccount(row) : null
    },

    upsertAccount: (input) => {
      const existing = db
        .prepare(`SELECT id FROM radar_accounts WHERE sec_user_id = ?`)
        .get(input.secUserId) as { id: string } | undefined
      const now = new Date().toISOString()
      const id = existing?.id || randomUUID()
      if (existing) {
        db.prepare(
          `UPDATE radar_accounts SET
             uid = @uid, unique_id = @uniqueId, nickname = @nickname,
             avatar_url = @avatarUrl, signature = @signature,
             follower_count = @followerCount, aweme_count = @awemeCount,
             profile_url = @profileUrl, source_input = @sourceInput,
             updated_at = @updatedAt
           WHERE id = @id`,
        ).run({
          id,
          uid: input.uid,
          uniqueId: input.uniqueId,
          nickname: input.nickname,
          avatarUrl: input.avatarUrl,
          signature: input.signature,
          followerCount: input.followerCount,
          awemeCount: input.awemeCount,
          profileUrl: input.profileUrl,
          sourceInput: input.sourceInput,
          updatedAt: now,
        })
      } else {
        db.prepare(
          `INSERT INTO radar_accounts (
             id, sec_user_id, uid, unique_id, nickname, avatar_url, signature,
             follower_count, aweme_count, profile_url, source_input, enabled,
             last_synced_at, created_at, updated_at
           ) VALUES (
             @id, @secUserId, @uid, @uniqueId, @nickname, @avatarUrl, @signature,
             @followerCount, @awemeCount, @profileUrl, @sourceInput, 1,
             NULL, @createdAt, @updatedAt
           )`,
        ).run({
          id,
          secUserId: input.secUserId,
          uid: input.uid,
          uniqueId: input.uniqueId,
          nickname: input.nickname,
          avatarUrl: input.avatarUrl,
          signature: input.signature,
          followerCount: input.followerCount,
          awemeCount: input.awemeCount,
          profileUrl: input.profileUrl,
          sourceInput: input.sourceInput,
          createdAt: now,
          updatedAt: now,
        })
      }
      return mapAccount(
        db
          .prepare(
            `SELECT a.*,
                    (SELECT COUNT(*) FROM radar_works w WHERE w.radar_account_id = a.id) AS work_count
             FROM radar_accounts a WHERE a.id = ?`,
          )
          .get(id) as AccountRow,
      )
    },

    setAccountEnabled: (id, enabled) => {
      const now = new Date().toISOString()
      const result = db
        .prepare(`UPDATE radar_accounts SET enabled = ?, updated_at = ? WHERE id = ?`)
        .run(enabled ? 1 : 0, now, id)
      if (result.changes === 0) throw new Error('对标账号不存在')
      return mapAccount(
        db
          .prepare(
            `SELECT a.*,
                    (SELECT COUNT(*) FROM radar_works w WHERE w.radar_account_id = a.id) AS work_count
             FROM radar_accounts a WHERE a.id = ?`,
          )
          .get(id) as AccountRow,
      )
    },

    markAccountSynced: (id) => {
      const now = new Date().toISOString()
      db.prepare(
        `UPDATE radar_accounts SET last_synced_at = ?, updated_at = ? WHERE id = ?`,
      ).run(now, now, id)
      return mapAccount(
        db
          .prepare(
            `SELECT a.*,
                    (SELECT COUNT(*) FROM radar_works w WHERE w.radar_account_id = a.id) AS work_count
             FROM radar_accounts a WHERE a.id = ?`,
          )
          .get(id) as AccountRow,
      )
    },

    removeAccount: (id) => {
      db.prepare(`DELETE FROM radar_works WHERE radar_account_id = ?`).run(id)
      const result = db.prepare(`DELETE FROM radar_accounts WHERE id = ?`).run(id)
      if (result.changes === 0) throw new Error('对标账号不存在')
    },

    listWorks: (filter, limit) => {
      const safeLimit = Math.max(1, Math.min(800, limit))
      let where = '1 = 1'
      if (filter === 'high') where = 'is_high = 1'
      else if (filter === 'new') where = 'is_new = 1'
      else if (filter === 'hot') where = 'is_hot = 1'
      const rows = db
        .prepare(
          `SELECT * FROM radar_works
           WHERE ${where}
           ORDER BY COALESCE(publish_at, updated_at) DESC
           LIMIT ?`,
        )
        .all(safeLimit) as WorkRow[]
      return rows.map(mapWork)
    },

    upsertWorks: (works) => {
      if (works.length === 0) return 0
      const now = new Date().toISOString()
      const select = db.prepare(`SELECT id FROM radar_works WHERE aweme_id = ?`)
      const insert = db.prepare(
        `INSERT INTO radar_works (
           id, aweme_id, radar_account_id, author_nickname, author_unique_id, title,
           cover_url, play_url, profile_url, digg_count, comment_count, share_count,
           play_count, duration_sec, publish_at, is_high, is_new, is_hot, source,
           first_seen_at, updated_at
         ) VALUES (
           @id, @awemeId, @radarAccountId, @authorNickname, @authorUniqueId, @title,
           @coverUrl, @playUrl, @profileUrl, @diggCount, @commentCount, @shareCount,
           @playCount, @durationSec, @publishAt, @isHigh, @isNew, @isHot, @source,
           @firstSeenAt, @updatedAt
         )`,
      )
      const update = db.prepare(
        `UPDATE radar_works SET
           radar_account_id = COALESCE(@radarAccountId, radar_account_id),
           author_nickname = @authorNickname,
           author_unique_id = @authorUniqueId,
           title = @title,
           cover_url = COALESCE(@coverUrl, cover_url),
           play_url = COALESCE(@playUrl, play_url),
           profile_url = COALESCE(@profileUrl, profile_url),
           digg_count = @diggCount,
           comment_count = @commentCount,
           share_count = @shareCount,
           play_count = @playCount,
           duration_sec = @durationSec,
           publish_at = COALESCE(@publishAt, publish_at),
           is_high = @isHigh,
           is_new = @isNew,
           is_hot = CASE WHEN @isHot = 1 OR is_hot = 1 THEN 1 ELSE 0 END,
           source = CASE WHEN source = 'hot' OR @source = 'hot' THEN 'hot' ELSE 'account' END,
           updated_at = @updatedAt
         WHERE aweme_id = @awemeId`,
      )
      let count = 0
      const run = db.transaction(() => {
        for (const work of works) {
          const existing = select.get(work.awemeId) as { id: string } | undefined
          const payload = {
            id: existing?.id || randomUUID(),
            awemeId: work.awemeId,
            radarAccountId: work.radarAccountId,
            authorNickname: work.authorNickname,
            authorUniqueId: work.authorUniqueId,
            title: work.title,
            coverUrl: work.coverUrl,
            playUrl: work.playUrl,
            profileUrl: work.profileUrl,
            diggCount: work.diggCount,
            commentCount: work.commentCount,
            shareCount: work.shareCount,
            playCount: work.playCount,
            durationSec: work.durationSec,
            publishAt: work.publishAt,
            isHigh: work.isHigh ? 1 : 0,
            isNew: work.isNew ? 1 : 0,
            isHot: work.isHot ? 1 : 0,
            source: work.source,
            firstSeenAt: now,
            updatedAt: now,
          }
          if (existing) update.run(payload)
          else insert.run(payload)
          count += 1
        }
      })
      run()
      return count
    },

    reclassifyWorks: (rules) => {
      const cutoff = new Date(Date.now() - rules.newWithinHours * 3600 * 1000).toISOString()
      db.prepare(
        `UPDATE radar_works SET
           is_high = CASE
             WHEN (@highMinDigg > 0 AND digg_count >= @highMinDigg)
               OR (@highMinPlay > 0 AND play_count >= @highMinPlay)
             THEN 1 ELSE 0
           END,
           is_new = CASE
             WHEN publish_at IS NOT NULL AND publish_at >= @cutoff THEN 1 ELSE 0
           END,
           updated_at = @updatedAt`,
      ).run({
        highMinDigg: rules.highMinDigg,
        highMinPlay: rules.highMinPlay,
        cutoff,
        updatedAt: new Date().toISOString(),
      })
    },

    getRules: () => {
      ensureRules()
      const row = db.prepare(`SELECT * FROM radar_rules WHERE id = 1`).get() as RulesRow
      return mapRules(row)
    },

    updateRules: (input) => {
      ensureRules()
      const current = mapRules(
        db.prepare(`SELECT * FROM radar_rules WHERE id = 1`).get() as RulesRow,
      )
      const next = {
        highMinDigg:
          input.highMinDigg != null ? Math.max(0, Math.floor(input.highMinDigg)) : current.highMinDigg,
        highMinPlay:
          input.highMinPlay != null ? Math.max(0, Math.floor(input.highMinPlay)) : current.highMinPlay,
        newWithinHours:
          input.newWithinHours != null
            ? Math.max(1, Math.floor(input.newWithinHours))
            : current.newWithinHours,
        hotKeywords: input.hotKeywords != null ? String(input.hotKeywords) : current.hotKeywords,
        autoSyncEnabled:
          input.autoSyncEnabled != null ? Boolean(input.autoSyncEnabled) : current.autoSyncEnabled,
        syncIntervalMinutes:
          input.syncIntervalMinutes != null
            ? Math.max(15, Math.floor(input.syncIntervalMinutes))
            : current.syncIntervalMinutes,
        updatedAt: new Date().toISOString(),
      }
      db.prepare(
        `UPDATE radar_rules SET
           high_min_digg = @highMinDigg,
           high_min_play = @highMinPlay,
           new_within_hours = @newWithinHours,
           hot_keywords = @hotKeywords,
           auto_sync_enabled = @autoSyncEnabled,
           sync_interval_minutes = @syncIntervalMinutes,
           updated_at = @updatedAt
         WHERE id = 1`,
      ).run({
        ...next,
        autoSyncEnabled: next.autoSyncEnabled ? 1 : 0,
      })
      return next
    },
  }
}