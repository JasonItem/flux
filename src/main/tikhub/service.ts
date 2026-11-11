import type {
  DouyinAccount,
  DouyinAccountPreview,
  DouyinVideoItem,
  DouyinVideoPage,
  TikHubBalanceStatus,
  TikHubConnectionTestResult,
  TikHubSettings,
  TikHubSettingsUpdateInput,
  TikHubUsageOverview,
} from '../../shared/tikhub'
import type { TikHubRepository } from './repository'
import {
  extractSecUserId,
  fetchOneVideo,
  fetchTikHubDailyUsage,
  fetchTikHubUserInfo,
  fetchUserPostVideos,
  fetchUserProfileBySecUserId,
  fetchUserProfileByUniqueId,
  fetchUserSearch,
  fetchVideoComments,
  fetchVideoSearch,
  type DouyinCommentItem,
  type DouyinSearchUserItem,
  type DouyinSearchVideoItem,
  type TikHubClientOptions,
} from './client'
import { parseDouyinAccountInput } from './resolveInput'

const BALANCE_CACHE_MS = 90_000
const DAILY_USAGE_CACHE_MS = 120_000

interface DailyUsageCache {
  todayRequests?: number
  todayCostUsd?: number
  fetchedAt: number
}

export interface TikHubService {
  getSettings: () => TikHubSettings
  updateSettings: (input: TikHubSettingsUpdateInput) => TikHubSettings
  testConnection: () => Promise<TikHubConnectionTestResult>
  getBalance: () => Promise<TikHubBalanceStatus>
  getUsage: (days?: number) => Promise<TikHubUsageOverview>
  listAccounts: () => DouyinAccount[]
  resolveAccount: (input: string) => Promise<DouyinAccountPreview>
  bindAccount: (preview: DouyinAccountPreview) => DouyinAccount
  refreshAccount: (id: string) => Promise<DouyinAccount>
  deleteAccount: (id: string) => void
  setActiveAccount: (id: string) => DouyinAccount
  listAccountVideos: (
    id: string,
    options?: { maxCursor?: string; count?: number },
  ) => Promise<DouyinVideoPage>
  searchVideos: (
    keyword: string,
    options?: { sortType?: '0' | '1' | '2'; pages?: number },
  ) => Promise<DouyinSearchVideoItem[]>
  searchUsers: (keyword: string) => Promise<DouyinSearchUserItem[]>
  listVideoComments: (awemeId: string, count?: number) => Promise<DouyinCommentItem[]>
  fetchOneVideo: (awemeId: string) => Promise<DouyinVideoItem | null>
}

function cacheAgeMs(fetchedAt: string | null | undefined): number {
  if (!fetchedAt) return Number.POSITIVE_INFINITY
  const stamp = Date.parse(fetchedAt)
  if (Number.isNaN(stamp)) return Number.POSITIVE_INFINITY
  return Date.now() - stamp
}

export function createTikHubService(repo: TikHubRepository): TikHubService {
  let lastBalance: TikHubBalanceStatus | null = null
  let lastDailyUsage: DailyUsageCache | null = null

  function requireClientOptions(): TikHubClientOptions {
    const settings = repo.getSettingsInternal()
    if (!settings.enabled) {
      throw new Error('请先在「TikHub配置」中启用接口')
    }
    if (!settings.apiToken.trim()) {
      throw new Error('请先填写 TikHub API Token')
    }
    return {
      endpoint: settings.endpoint,
      apiToken: settings.apiToken,
      timeoutSeconds: settings.timeoutSeconds,
      onUsage: (entry) => {
        repo.insertUsage(entry)
      },
    }
  }

  function accountOptions(): TikHubClientOptions | null {
    const settings = repo.getSettingsInternal()
    if (!settings.apiToken.trim() || !settings.enabled) return null
    return {
      endpoint: settings.endpoint,
      apiToken: settings.apiToken,
      timeoutSeconds: settings.timeoutSeconds,
    }
  }

  async function fetchBalanceStatus(force = false): Promise<TikHubBalanceStatus> {
    const settings = repo.getSettingsInternal()
    if (!settings.apiToken.trim() || !settings.enabled) {
      lastBalance = null
      return {
        ready: false,
        ok: false,
        message: settings.apiToken.trim() ? 'TikHub 未启用' : '尚未配置 TikHub',
        fetchedAt: null,
      }
    }

    if (
      !force &&
      lastBalance?.ready &&
      lastBalance.ok &&
      cacheAgeMs(lastBalance.fetchedAt) < BALANCE_CACHE_MS
    ) {
      return lastBalance
    }

    try {
      const info = await fetchTikHubUserInfo({
        endpoint: settings.endpoint,
        apiToken: settings.apiToken,
        timeoutSeconds: settings.timeoutSeconds,
      })
      lastBalance = {
        ready: true,
        ok: true,
        balance: info.balance,
        freeCredit: info.freeCredit,
        email: info.email,
        message: 'ok',
        fetchedAt: new Date().toISOString(),
      }
      return lastBalance
    } catch (error) {
      const message = error instanceof Error ? error.message : '余额查询失败'
      if (lastBalance?.ready) {
        return {
          ...lastBalance,
          ok: lastBalance.ok,
          message,
        }
      }
      return {
        ready: true,
        ok: false,
        message,
        fetchedAt: new Date().toISOString(),
      }
    }
  }

  async function fetchDailyUsageCached(force = false): Promise<DailyUsageCache | null> {
    const options = accountOptions()
    if (!options) return null

    if (
      !force &&
      lastDailyUsage &&
      Date.now() - lastDailyUsage.fetchedAt < DAILY_USAGE_CACHE_MS
    ) {
      return lastDailyUsage
    }

    try {
      const daily = await fetchTikHubDailyUsage(options)
      lastDailyUsage = {
        todayRequests: daily.todayRequests,
        todayCostUsd: daily.todayCostUsd,
        fetchedAt: Date.now(),
      }
      return lastDailyUsage
    } catch {
      return lastDailyUsage
    }
  }

  return {
    getSettings: () => repo.getSettings(),
    updateSettings: (input) => {
      lastBalance = null
      lastDailyUsage = null
      return repo.updateSettings(input)
    },

    testConnection: async () => {
      const settings = repo.getSettingsInternal()
      if (!settings.apiToken.trim()) {
        return { ok: false, message: '请先填写 API Token' }
      }
      try {
        const info = await fetchTikHubUserInfo({
          endpoint: settings.endpoint,
          apiToken: settings.apiToken,
          timeoutSeconds: settings.timeoutSeconds,
        })
        if (settings.enabled) {
          lastBalance = {
            ready: true,
            ok: true,
            balance: info.balance,
            freeCredit: info.freeCredit,
            email: info.email,
            message: 'ok',
            fetchedAt: new Date().toISOString(),
          }
        }
        return {
          ok: true,
          email: info.email,
          balance: info.balance,
          freeCredit: info.freeCredit,
          apiKeyName: info.apiKeyName,
          message: info.email
            ? `连接成功：${info.email}`
            : '连接成功，已验证 Token 有效',
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : '连接失败',
        }
      }
    },

    getBalance: () => fetchBalanceStatus(false),

    getUsage: async (days = 14) => {
      const settings = repo.getSettingsInternal()
      const series = repo.getUsageSeries(days)
      const recentCalls = repo.listUsage(50)
      const totals = series.reduce(
        (acc, day) => {
          acc.requests += day.requests
          acc.successCount += day.successCount
          acc.errorCount += day.errorCount
          return acc
        },
        { requests: 0, successCount: 0, errorCount: 0 },
      )

      if (!settings.apiToken.trim() || !settings.enabled) {
        return {
          ready: false,
          ok: false,
          message: settings.apiToken.trim() ? 'TikHub 未启用' : '尚未配置 TikHub',
          series,
          recentCalls,
          totals,
        }
      }

      const [balance, daily] = await Promise.all([
        fetchBalanceStatus(false),
        fetchDailyUsageCached(false),
      ])

      const remoteOk = Boolean(balance.ok && balance.balance !== undefined)
      const rateLimited = /429|Too Many Requests|频率|限流/i.test(balance.message)
      const now = new Date()
      const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const localToday = series.find((item) => item.date === todayKey)?.requests

      return {
        ready: true,
        ok: remoteOk || Boolean(lastBalance?.ok),
        message: remoteOk
          ? 'ok'
          : rateLimited
            ? '请求过于频繁，已展示缓存/本机数据，请稍后再同步官方用量'
            : balance.message,
        balance: balance.balance ?? lastBalance?.balance,
        freeCredit: balance.freeCredit ?? lastBalance?.freeCredit,
        email: balance.email ?? lastBalance?.email,
        // 官方日用量解析失败时，回退到本机今日调用
        todayRequests:
          daily?.todayRequests !== undefined ? daily.todayRequests : localToday,
        todayCostUsd: daily?.todayCostUsd,
        series,
        recentCalls,
        totals,
      }
    },

    listAccounts: () => repo.listAccounts(),

    resolveAccount: async (input) => {
      const options = requireClientOptions()
      const parsed = parseDouyinAccountInput(input)

      if (parsed.kind === 'unique_id') {
        const result = await fetchUserProfileByUniqueId(
          options,
          parsed.value,
          parsed.sourceInput,
        )
        return result.preview
      }

      const secUserId =
        parsed.kind === 'profile_url'
          ? parsed.value
          : await extractSecUserId(options, parsed.value)

      const result = await fetchUserProfileBySecUserId(
        options,
        secUserId,
        parsed.sourceInput,
      )
      return result.preview
    },

    bindAccount: (preview) => {
      if (!preview.secUserId) throw new Error('缺少 sec_user_id，无法绑定')
      return repo.bindAccount(preview)
    },

    refreshAccount: async (id) => {
      const options = requireClientOptions()
      const current = repo.getAccount(id)
      const result = await fetchUserProfileBySecUserId(
        options,
        current.secUserId,
        current.sourceInput,
      )
      return repo.updateAccountProfile(id, result.preview, JSON.stringify(result.raw))
    },

    deleteAccount: (id) => {
      repo.deleteAccount(id)
    },

    setActiveAccount: (id) => repo.setActiveAccount(id),

    listAccountVideos: async (id, options) => {
      const client = requireClientOptions()
      const account = repo.getAccount(id)
      return fetchUserPostVideos(
        client,
        account.secUserId,
        options?.maxCursor ?? '0',
        options?.count ?? 12,
      )
    },

    searchVideos: async (keyword, options) => {
      const client = requireClientOptions()
      const query = keyword.trim()
      if (!query) throw new Error('搜索关键词不能为空')
      return fetchVideoSearch(client, query, {
        sortType: options?.sortType ?? '1',
        pages: options?.pages,
      })
    },

    searchUsers: async (keyword) => {
      const client = requireClientOptions()
      const query = keyword.trim()
      if (!query) throw new Error('搜索关键词不能为空')
      return fetchUserSearch(client, query)
    },

    listVideoComments: async (awemeId, count = 20) => {
      const client = requireClientOptions()
      if (!awemeId.trim()) throw new Error('缺少视频 ID')
      return fetchVideoComments(client, awemeId.trim(), count)
    },

    fetchOneVideo: async (awemeId) => {
      const client = requireClientOptions()
      const id = awemeId.trim()
      if (!id) throw new Error('缺少视频 ID')
      return fetchOneVideo(client, id)
    },
  }
}
