import type {
  RadarAccount,
  RadarRules,
  RadarRulesUpdateInput,
  RadarSignalFilter,
  RadarSignalsQuery,
  RadarSyncResult,
  RadarWork,
} from '../../shared/radar'
import type { TikHubService } from '../tikhub/service'
import type { RadarRepository, RadarWorkUpsertInput } from './repository'

export interface RadarService {
  listAccounts: () => RadarAccount[]
  addAccount: (input: string) => Promise<RadarAccount>
  removeAccount: (id: string) => void
  setAccountEnabled: (id: string, enabled: boolean) => RadarAccount
  syncAccount: (id: string) => Promise<RadarSyncResult>
  syncAllAccounts: () => Promise<RadarSyncResult[]>
  listSignals: (query?: RadarSignalsQuery) => RadarWork[]
  refreshHot: () => Promise<{ fetched: number; upserted: number }>
  getRules: () => RadarRules
  updateRules: (input: RadarRulesUpdateInput) => RadarRules
}

function publishAtFromCreateTime(createTime: number | null): string | null {
  if (!createTime || !Number.isFinite(createTime) || createTime <= 0) return null
  const ms = createTime > 1e12 ? createTime : createTime * 1000
  return new Date(ms).toISOString()
}

/** 抖音搜索结果常缺真实播放量：有则用原值，否则按赞×25 粗估（与赛道自测一致） */
function resolvePlayCount(playCount: number, diggCount: number): number {
  if (playCount > 0) return playCount
  return Math.max(0, diggCount) * 25
}

function classifyWork(
  diggCount: number,
  playCount: number,
  publishAt: string | null,
  rules: RadarRules,
  forceHot = false,
): { isHigh: boolean; isNew: boolean; isHot: boolean } {
  const cutoff = Date.now() - rules.newWithinHours * 3600 * 1000
  const published = publishAt ? new Date(publishAt).getTime() : NaN
  // 阈值为 0 表示不启用该维度；避免「最低播放=0」把全部作品都标成高表现
  const diggHit = rules.highMinDigg > 0 && diggCount >= rules.highMinDigg
  const playHit = rules.highMinPlay > 0 && playCount >= rules.highMinPlay
  return {
    isHigh: diggHit || playHit,
    isNew: Number.isFinite(published) && published >= cutoff,
    isHot: forceHot,
  }
}

function accountVideoToWork(
  video: {
    awemeId: string
    description: string
    coverUrl: string | null
    playUrl: string | null
    diggCount: number
    commentCount: number
    shareCount: number
    playCount: number
    durationMs: number | null
    createTime: number | null
  },
  account: RadarAccount,
  rules: RadarRules,
): RadarWorkUpsertInput {
  const publishAt = publishAtFromCreateTime(video.createTime)
  const playCount = resolvePlayCount(video.playCount, video.diggCount)
  const flags = classifyWork(video.diggCount, playCount, publishAt, rules)
  return {
    awemeId: video.awemeId,
    radarAccountId: account.id,
    authorNickname: account.nickname,
    authorUniqueId: account.uniqueId,
    title: video.description?.trim() || '无标题作品',
    coverUrl: video.coverUrl,
    playUrl: video.playUrl,
    profileUrl: account.profileUrl,
    diggCount: video.diggCount,
    commentCount: video.commentCount,
    shareCount: video.shareCount,
    playCount,
    durationSec: video.durationMs ? Math.round(video.durationMs / 1000) : 0,
    publishAt,
    isHigh: flags.isHigh,
    isNew: flags.isNew,
    isHot: flags.isHot,
    source: 'account',
  }
}

export function createRadarService(
  repo: RadarRepository,
  tikhub: TikHubService,
): RadarService {
  let autoSyncTimer: ReturnType<typeof setInterval> | null = null
  let autoSyncInFlight = false

  function restartAutoSyncTimer() {
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer)
      autoSyncTimer = null
    }
    const rules = repo.getRules()
    if (!rules.autoSyncEnabled) return
    const ms = Math.max(15, rules.syncIntervalMinutes) * 60 * 1000
    autoSyncTimer = setInterval(() => {
      if (autoSyncInFlight) return
      autoSyncInFlight = true
      void service
        .syncAllAccounts()
        .catch((error) => {
          console.warn('[radar] auto sync failed', error)
        })
        .finally(() => {
          autoSyncInFlight = false
        })
    }, ms)
  }

  async function syncOne(account: RadarAccount, rules: RadarRules): Promise<RadarSyncResult> {
    let cursor = '0'
    let fetched = 0
    const batch: RadarWorkUpsertInput[] = []
    for (let page = 0; page < 5; page += 1) {
      const result = await tikhub.fetchUserPostVideos(account.secUserId, {
        maxCursor: cursor,
        count: 20,
      })
      for (const item of result.items) {
        if (!item.awemeId) continue
        batch.push(accountVideoToWork(item, account, rules))
        fetched += 1
      }
      if (!result.hasMore || !result.maxCursor || result.maxCursor === cursor) break
      cursor = result.maxCursor
    }
    const upserted = repo.upsertWorks(batch)
    repo.markAccountSynced(account.id)
    return {
      accountId: account.id,
      nickname: account.nickname,
      fetched,
      upserted,
    }
  }

  const service: RadarService = {
    listAccounts: () => repo.listAccounts(),

    addAccount: async (input) => {
      const preview = await tikhub.resolveAccount(input)
      const existing = repo.findAccountBySecUserId(preview.secUserId)
      const account = repo.upsertAccount({
        secUserId: preview.secUserId,
        uid: preview.uid,
        uniqueId: preview.uniqueId,
        nickname: preview.nickname,
        avatarUrl: preview.avatarUrl,
        signature: preview.signature,
        followerCount: preview.followerCount,
        awemeCount: preview.awemeCount,
        profileUrl: preview.profileUrl,
        sourceInput: preview.sourceInput || input,
      })
      if (existing) return account
      try {
        await syncOne(account, repo.getRules())
      } catch {
        // keep account even if first sync fails
      }
      return repo.getAccount(account.id)
    },

    removeAccount: (id) => {
      repo.removeAccount(id)
    },

    setAccountEnabled: (id, enabled) => repo.setAccountEnabled(id, enabled),

    syncAccount: async (id) => {
      const account = repo.getAccount(id)
      return syncOne(account, repo.getRules())
    },

    syncAllAccounts: async () => {
      const rules = repo.getRules()
      const accounts = repo.listAccounts().filter((item) => item.enabled)
      const results: RadarSyncResult[] = []
      for (const account of accounts) {
        results.push(await syncOne(account, rules))
      }
      repo.reclassifyWorks(rules)
      return results
    },

    listSignals: (query) => {
      const filter = (query?.filter ?? 'all') as RadarSignalFilter
      const limit = query?.limit ?? 500
      return repo.listWorks(filter, limit)
    },

    refreshHot: async () => {
      const rules = repo.getRules()
      const keywords = rules.hotKeywords
        .split(/[\n,，]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20)
      if (keywords.length === 0) {
        throw new Error('请先在「监听规则」里填写热榜关键词')
      }
      const batch: RadarWorkUpsertInput[] = []
      const seen = new Set<string>()
      let fetched = 0
      // 热门 + 综合双排序多翻页，避免单次搜索只回十来条
      const searchPlans: Array<{ sortType: '0' | '1'; pages: number }> = [
        { sortType: '1', pages: 8 },
        { sortType: '0', pages: 4 },
      ]
      for (const keyword of keywords) {
        for (const plan of searchPlans) {
          const items = await tikhub.searchVideos(keyword, {
            sortType: plan.sortType,
            pages: plan.pages,
          })
          for (const item of items) {
            if (!item.awemeId || seen.has(item.awemeId)) continue
            seen.add(item.awemeId)
            const publishAt = publishAtFromCreateTime(item.createTime)
            const playCount = resolvePlayCount(item.playCount, item.diggCount)
            const flags = classifyWork(item.diggCount, playCount, publishAt, rules, true)
            batch.push({
              awemeId: item.awemeId,
              radarAccountId: null,
              authorNickname: item.authorNickname || '热榜作者',
              authorUniqueId: item.authorUniqueId ?? null,
              title: item.description?.trim() || keyword,
              coverUrl: item.coverUrl,
              playUrl: item.playUrl,
              profileUrl: item.authorSecUid
                ? `https://www.douyin.com/user/${item.authorSecUid}`
                : null,
              diggCount: item.diggCount,
              commentCount: item.commentCount,
              shareCount: item.shareCount,
              playCount,
              durationSec: item.durationMs ? Math.round(item.durationMs / 1000) : 0,
              publishAt,
              isHigh: flags.isHigh,
              isNew: flags.isNew,
              isHot: true,
              source: 'hot',
            })
            fetched += 1
          }
        }
      }
      const upserted = repo.upsertWorks(batch)
      return { fetched, upserted }
    },

    getRules: () => repo.getRules(),

    updateRules: (input: RadarRulesUpdateInput) => {
      const next = repo.updateRules(input)
      repo.reclassifyWorks(next)
      restartAutoSyncTimer()
      return next
    },
  }

  restartAutoSyncTimer()
  // 纠正历史误标（例如最低播放=0 时把全部作品标成高表现）
  repo.reclassifyWorks(repo.getRules())
  return service
}