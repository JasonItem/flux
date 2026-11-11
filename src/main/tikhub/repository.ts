import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type {
  DouyinAccount,
  DouyinAccountPreview,
  TikHubCallRecord,
  TikHubSettings,
  TikHubSettingsUpdateInput,
  TikHubUsageDayStat,
} from '../../shared/tikhub'

interface SettingsRow {
  id: number
  endpoint: string
  api_token: string
  timeout_seconds: number
  enabled: number
  updated_at: string
}

interface AccountRow {
  id: string
  sec_user_id: string
  uid: string | null
  unique_id: string | null
  nickname: string
  avatar_url: string | null
  signature: string | null
  follower_count: number
  following_count: number
  aweme_count: number
  total_favorited: number
  profile_url: string | null
  source_input: string
  is_active: number
  raw_json: string | null
  created_at: string
  updated_at: string
}

export interface TikHubSettingsInternal extends TikHubSettings {
  apiToken: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function maskToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '••••'
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`
}

function mapSettings(row: SettingsRow): TikHubSettings {
  return {
    endpoint: row.endpoint,
    apiTokenMasked: maskToken(row.api_token),
    hasApiToken: row.api_token.trim().length > 0,
    timeoutSeconds: row.timeout_seconds,
    enabled: row.enabled === 1,
    updatedAt: row.updated_at,
  }
}

function mapAccount(row: AccountRow): DouyinAccount {
  return {
    id: row.id,
    secUserId: row.sec_user_id,
    uid: row.uid,
    uniqueId: row.unique_id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    signature: row.signature,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    awemeCount: row.aweme_count,
    totalFavorited: row.total_favorited,
    profileUrl: row.profile_url,
    sourceInput: row.source_input,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface TikHubRepository {
  getSettings: () => TikHubSettings
  getSettingsInternal: () => TikHubSettingsInternal
  updateSettings: (input: TikHubSettingsUpdateInput) => TikHubSettings
  listAccounts: () => DouyinAccount[]
  getAccount: (id: string) => DouyinAccount
  findBySecUserId: (secUserId: string) => DouyinAccount | null
  bindAccount: (preview: DouyinAccountPreview, rawJson?: string) => DouyinAccount
  updateAccountProfile: (
    id: string,
    preview: DouyinAccountPreview,
    rawJson?: string,
  ) => DouyinAccount
  deleteAccount: (id: string) => void
  setActiveAccount: (id: string) => DouyinAccount
  insertUsage: (input: {
    path: string
    ok: boolean
    statusCode?: number | null
    message?: string | null
  }) => void
  listUsage: (limit?: number) => TikHubCallRecord[]
  getUsageSeries: (days?: number) => TikHubUsageDayStat[]
}

export function createTikHubRepository(db: Database.Database): TikHubRepository {
  const selectSettings = db.prepare(
    `SELECT id, endpoint, api_token, timeout_seconds, enabled, updated_at
     FROM tikhub_settings WHERE id = 1`,
  )

  const selectAccount = db.prepare(
    `SELECT id, sec_user_id, uid, unique_id, nickname, avatar_url, signature,
            follower_count, following_count, aweme_count, total_favorited,
            profile_url, source_input, is_active, raw_json, created_at, updated_at
     FROM douyin_accounts WHERE id = ?`,
  )

  const selectBySec = db.prepare(
    `SELECT id, sec_user_id, uid, unique_id, nickname, avatar_url, signature,
            follower_count, following_count, aweme_count, total_favorited,
            profile_url, source_input, is_active, raw_json, created_at, updated_at
     FROM douyin_accounts WHERE sec_user_id = ?`,
  )

  const clearActive = db.prepare(`UPDATE douyin_accounts SET is_active = 0 WHERE is_active = 1`)

  function requireSettings(): SettingsRow {
    const row = selectSettings.get() as SettingsRow | undefined
    if (!row) throw new Error('TikHub 配置尚未初始化')
    return row
  }

  function requireAccount(id: string): AccountRow {
    const row = selectAccount.get(id) as AccountRow | undefined
    if (!row) throw new Error('抖音账号不存在')
    return row
  }

  return {
    getSettings: () => mapSettings(requireSettings()),

    getSettingsInternal: () => {
      const row = requireSettings()
      return {
        ...mapSettings(row),
        apiToken: row.api_token,
      }
    },

    updateSettings: (input) => {
      const current = requireSettings()
      const endpoint =
        input.endpoint !== undefined
          ? input.endpoint.trim().replace(/\/+$/, '')
          : current.endpoint
      if (!endpoint) throw new Error('接口地址不能为空')

      const apiToken =
        input.apiToken !== undefined && input.apiToken.trim().length > 0
          ? input.apiToken.trim()
          : current.api_token
      const timeoutSeconds =
        input.timeoutSeconds !== undefined
          ? Math.max(1, Math.min(120, Math.round(input.timeoutSeconds)))
          : current.timeout_seconds
      const enabled =
        input.enabled !== undefined ? (input.enabled ? 1 : 0) : current.enabled
      const stamp = nowIso()

      db.prepare(
        `UPDATE tikhub_settings
         SET endpoint = @endpoint, api_token = @apiToken, timeout_seconds = @timeoutSeconds,
             enabled = @enabled, updated_at = @updatedAt
         WHERE id = 1`,
      ).run({
        endpoint,
        apiToken,
        timeoutSeconds,
        enabled,
        updatedAt: stamp,
      })
      return mapSettings(requireSettings())
    },

    listAccounts: () => {
      const rows = db
        .prepare(
          `SELECT id, sec_user_id, uid, unique_id, nickname, avatar_url, signature,
                  follower_count, following_count, aweme_count, total_favorited,
                  profile_url, source_input, is_active, raw_json, created_at, updated_at
           FROM douyin_accounts
           ORDER BY is_active DESC, updated_at DESC`,
        )
        .all() as AccountRow[]
      return rows.map(mapAccount)
    },

    getAccount: (id) => mapAccount(requireAccount(id)),

    findBySecUserId: (secUserId) => {
      const row = selectBySec.get(secUserId) as AccountRow | undefined
      return row ? mapAccount(row) : null
    },

    bindAccount: (preview, rawJson) => {
      const existing = selectBySec.get(preview.secUserId) as AccountRow | undefined
      const stamp = nowIso()
      if (existing) {
        db.prepare(
          `UPDATE douyin_accounts
           SET uid = @uid, unique_id = @uniqueId, nickname = @nickname, avatar_url = @avatarUrl,
               signature = @signature, follower_count = @followerCount,
               following_count = @followingCount, aweme_count = @awemeCount,
               total_favorited = @totalFavorited, profile_url = @profileUrl,
               source_input = @sourceInput, raw_json = @rawJson, updated_at = @updatedAt
           WHERE id = @id`,
        ).run({
          id: existing.id,
          uid: preview.uid,
          uniqueId: preview.uniqueId,
          nickname: preview.nickname,
          avatarUrl: preview.avatarUrl,
          signature: preview.signature,
          followerCount: preview.followerCount,
          followingCount: preview.followingCount,
          awemeCount: preview.awemeCount,
          totalFavorited: preview.totalFavorited,
          profileUrl: preview.profileUrl,
          sourceInput: preview.sourceInput,
          rawJson: rawJson ?? existing.raw_json,
          updatedAt: stamp,
        })
        return mapAccount(requireAccount(existing.id))
      }

      const id = randomUUID()
      const count = (
        db.prepare(`SELECT COUNT(*) AS c FROM douyin_accounts`).get() as { c: number }
      ).c
      db.prepare(
        `INSERT INTO douyin_accounts
         (id, sec_user_id, uid, unique_id, nickname, avatar_url, signature,
          follower_count, following_count, aweme_count, total_favorited,
          profile_url, source_input, is_active, raw_json, created_at, updated_at)
         VALUES
         (@id, @secUserId, @uid, @uniqueId, @nickname, @avatarUrl, @signature,
          @followerCount, @followingCount, @awemeCount, @totalFavorited,
          @profileUrl, @sourceInput, @isActive, @rawJson, @createdAt, @updatedAt)`,
      ).run({
        id,
        secUserId: preview.secUserId,
        uid: preview.uid,
        uniqueId: preview.uniqueId,
        nickname: preview.nickname,
        avatarUrl: preview.avatarUrl,
        signature: preview.signature,
        followerCount: preview.followerCount,
        followingCount: preview.followingCount,
        awemeCount: preview.awemeCount,
        totalFavorited: preview.totalFavorited,
        profileUrl: preview.profileUrl,
        sourceInput: preview.sourceInput,
        isActive: count === 0 ? 1 : 0,
        rawJson: rawJson ?? null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      return mapAccount(requireAccount(id))
    },

    updateAccountProfile: (id, preview, rawJson) => {
      const current = requireAccount(id)
      const stamp = nowIso()
      db.prepare(
        `UPDATE douyin_accounts
         SET sec_user_id = @secUserId, uid = @uid, unique_id = @uniqueId, nickname = @nickname,
             avatar_url = @avatarUrl, signature = @signature, follower_count = @followerCount,
             following_count = @followingCount, aweme_count = @awemeCount,
             total_favorited = @totalFavorited, profile_url = @profileUrl,
             source_input = @sourceInput, raw_json = @rawJson, updated_at = @updatedAt
         WHERE id = @id`,
      ).run({
        id,
        secUserId: preview.secUserId,
        uid: preview.uid,
        uniqueId: preview.uniqueId,
        nickname: preview.nickname,
        avatarUrl: preview.avatarUrl,
        signature: preview.signature,
        followerCount: preview.followerCount,
        followingCount: preview.followingCount,
        awemeCount: preview.awemeCount,
        totalFavorited: preview.totalFavorited,
        profileUrl: preview.profileUrl,
        sourceInput: preview.sourceInput || current.source_input,
        rawJson: rawJson ?? current.raw_json,
        updatedAt: stamp,
      })
      return mapAccount(requireAccount(id))
    },

    deleteAccount: (id) => {
      requireAccount(id)
      db.prepare(`DELETE FROM douyin_accounts WHERE id = ?`).run(id)
    },

    setActiveAccount: (id) => {
      requireAccount(id)
      const apply = db.transaction(() => {
        clearActive.run()
        db.prepare(
          `UPDATE douyin_accounts SET is_active = 1, updated_at = @updatedAt WHERE id = @id`,
        ).run({ id, updatedAt: nowIso() })
      })
      apply()
      return mapAccount(requireAccount(id))
    },

    insertUsage: (input) => {
      db.prepare(
        `INSERT INTO tikhub_usage (id, created_at, path, ok, status_code, message)
         VALUES (@id, @createdAt, @path, @ok, @statusCode, @message)`,
      ).run({
        id: randomUUID(),
        createdAt: nowIso(),
        path: input.path,
        ok: input.ok ? 1 : 0,
        statusCode: input.statusCode ?? null,
        message: input.message ?? null,
      })
    },

    listUsage: (limit = 100) => {
      const safeLimit = Math.max(1, Math.min(500, Math.round(limit)))
      const rows = db
        .prepare(
          `SELECT id, created_at, path, ok, status_code, message
           FROM tikhub_usage
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(safeLimit) as Array<{
        id: string
        created_at: string
        path: string
        ok: number
        status_code: number | null
        message: string | null
      }>

      return rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        path: row.path,
        ok: row.ok === 1,
        statusCode: row.status_code,
        message: row.message,
      }))
    },

    getUsageSeries: (days = 14) => {
      const safeDays = Math.max(1, Math.min(90, Math.round(days)))
      const since = new Date()
      since.setHours(0, 0, 0, 0)
      since.setDate(since.getDate() - (safeDays - 1))
      const sinceIso = since.toISOString()

      const localDayKey = (value: Date | string): string => {
        const date = value instanceof Date ? value : new Date(value)
        if (Number.isNaN(date.getTime())) {
          return typeof value === 'string' ? value.slice(0, 10) : ''
        }
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
      }

      const rows = db
        .prepare(
          `SELECT created_at, ok FROM tikhub_usage WHERE created_at >= ? ORDER BY created_at ASC`,
        )
        .all(sinceIso) as Array<{ created_at: string; ok: number }>

      const dayMap = new Map<string, TikHubUsageDayStat>()
      for (let i = 0; i < safeDays; i += 1) {
        const day = new Date(since)
        day.setDate(since.getDate() + i)
        const key = localDayKey(day)
        dayMap.set(key, { date: key, requests: 0, successCount: 0, errorCount: 0 })
      }

      for (const row of rows) {
        const key = localDayKey(row.created_at)
        const day = dayMap.get(key)
        if (!day) continue
        day.requests += 1
        if (row.ok === 1) day.successCount += 1
        else day.errorCount += 1
      }

      return [...dayMap.values()]
    },
  }
}
