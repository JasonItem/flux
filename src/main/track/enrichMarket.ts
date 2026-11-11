import type { DouyinAccount, DouyinVideoItem } from '../../shared/tikhub'
import type { TrackInfluencer, TrackMarketMetrics } from '../../shared/track'
import type { DouyinSearchUserItem, DouyinSearchVideoItem } from '../tikhub/client'
import type { TikHubService } from '../tikhub/service'
import type { TrackCandidateInsert } from './repository'

const MARKET_CONCURRENCY = 3

function clampScore(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)))
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((sum, n) => sum + n, 0) / nums.length
}

/** 把长赛道名压成可搜短词；优先使用模型给的 searchHint */
export function buildSearchQuery(trackName: string, searchHint?: string | null): string {
  const hint = (searchHint ?? '').replace(/\s+/g, '').trim()
  if (hint.length >= 2 && hint.length <= 12) return hint

  const stripped = trackName
    .replace(
      /知识干货|实操复盘|经验故事|资讯解读|现场观察|新手避坑|案例拆解|趋势解读|人物故事|政策解读|对照练习|高频问题拆解|指南|拆解|观察|干货|实操|复盘|测评|纪实|教程|攻略/g,
      ' ',
    )
    .replace(/[·|/／、，,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const chunks = stripped
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)

  if (chunks.length === 0) {
    const compact = trackName.replace(/\s+/g, '').trim()
    return compact.slice(0, 8) || trackName
  }

  // 取最长的 1～2 段，拼成 2～10 字检索词
  const ranked = [...chunks].sort((a, b) => b.length - a.length)
  const primary = ranked[0] ?? ''
  const secondary = ranked.find((item) => item !== primary && !primary.includes(item)) ?? ''
  const merged = `${primary}${secondary}`.slice(0, 10)
  return merged.length >= 2 ? merged : primary.slice(0, 8)
}

function matchAccountVideos(
  videos: DouyinVideoItem[],
  trackName: string,
  searchQuery: string,
): DouyinVideoItem[] {
  const keys = `${trackName} ${searchQuery}`
    .replace(/知识干货|实操复盘|经验故事|资讯解读|现场观察|新手避坑|指南|拆解|观察|干货/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
  const chars = [...searchQuery, ...trackName].filter((ch) => /[\u4e00-\u9fffA-Za-z0-9]/.test(ch))

  return [...videos]
    .map((video) => {
      const text = `${video.description}`.toLowerCase()
      const keyHits = keys.filter((key) => text.includes(key.toLowerCase())).length
      const charHits = chars.filter((ch) => text.includes(ch.toLowerCase())).length
      const score =
        keyHits * 8 +
        charHits * 0.35 +
        Math.log10(1 + video.diggCount + video.commentCount * 2)
      return { video, score }
    })
    .filter((item) => item.score > 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.video)
}

/** 搜索结果常缺 play_count：有播放用播放，否则用赞×25 粗估 */
function estimatedPlay(item: { playCount: number; diggCount: number }): number {
  if (item.playCount > 0) return item.playCount
  return Math.max(0, item.diggCount) * 25
}

function formatPlayLabel(item: { playCount: number; diggCount: number }): string {
  const play = estimatedPlay(item)
  if (item.playCount > 0) return `播 ${String(item.playCount)}`
  if (play > 0) return `估播 ${String(play)}`
  return '播 —'
}

function influencersFromVideos(market: DouyinSearchVideoItem[]): TrackInfluencer[] {
  const byKey = new Map<string, DouyinSearchVideoItem>()
  for (const item of market) {
    const key = item.authorSecUid || item.authorUniqueId || item.authorNickname
    if (!key) continue
    const prev = byKey.get(key)
    if (!prev || item.authorFollowerCount > prev.authorFollowerCount) {
      byKey.set(key, item)
    }
  }

  return [...byKey.values()]
    .sort(
      (a, b) =>
        b.authorFollowerCount - a.authorFollowerCount ||
        estimatedPlay(b) - estimatedPlay(a) ||
        b.diggCount - a.diggCount,
    )
    .slice(0, 6)
    .map((item) => ({
      nickname: item.authorNickname,
      uniqueId: item.authorUniqueId,
      avatarUrl: item.authorAvatarUrl,
      signature: item.authorSignature,
      followerCount: item.authorFollowerCount,
      awemeCount: item.authorAwemeCount,
      highlight: `代表作：${formatPlayLabel(item)} · 赞 ${String(item.diggCount)} · 「${item.description.slice(0, 28)}${item.description.length > 28 ? '…' : ''}」`,
      profileUrl: item.authorSecUid
        ? `https://www.douyin.com/user/${item.authorSecUid}`
        : item.shareUrl ||
          `https://www.douyin.com/search/${encodeURIComponent(item.authorUniqueId || item.authorNickname)}`,
    }))
}

function influencersFromUsers(users: DouyinSearchUserItem[], searchQuery: string): TrackInfluencer[] {
  return users.slice(0, 6).map((user) => ({
    nickname: user.nickname,
    uniqueId: user.uniqueId,
    avatarUrl: user.avatarUrl,
    signature: user.signature,
    followerCount: user.followerCount,
    awemeCount: user.awemeCount,
    highlight: `用户搜索命中「${searchQuery}」，适合作为对标账号。`,
    profileUrl: user.profileUrl,
  }))
}

function uniqueCreatorCount(market: DouyinSearchVideoItem[]): number {
  const keys = new Set<string>()
  for (const item of market) {
    keys.add(item.authorSecUid || item.authorUniqueId || item.authorNickname)
  }
  return Math.max(keys.size, market.length > 0 ? 1 : 0)
}

/**
 * 市场指标：
 * - 浏览量：样本均播（缺 play_count 时用赞×25 估）
 * - 竞争：样本作者平均粉丝（大号越多越卷；避免「总播/作者≈均播」失真）
 * - 潜力：先算相对原始分，同批候选再拉开分布（避免人人 100）
 */
function metricsFromMarket(args: {
  matchedVideos: DouyinVideoItem[]
  market: DouyinSearchVideoItem[]
  index: number
}): TrackMarketMetrics {
  const plays = args.market.map((item) => estimatedPlay(item))
  const diggs = args.market.map((item) => Math.max(0, item.diggCount))
  const followers = args.market.map((item) => Math.max(0, item.authorFollowerCount))
  const totalPlayCount = plays.reduce((sum, n) => sum + n, 0)
  const avgPlayCount = avg(plays)
  const avgDiggCount = avg(diggs)
  const sampleVideoCount = args.market.length
  const creatorCount = uniqueCreatorCount(args.market)
  // 按去重作者取均粉：同一作者多条只计一次粉丝
  const followerByCreator = new Map<string, number>()
  for (const item of args.market) {
    const key = item.authorSecUid || item.authorUniqueId || item.authorNickname
    if (!key) continue
    const prev = followerByCreator.get(key) ?? 0
    if (item.authorFollowerCount > prev) followerByCreator.set(key, item.authorFollowerCount)
  }
  const avgCreatorFollowers =
    followerByCreator.size > 0
      ? avg([...followerByCreator.values()])
      : avg(followers)
  const diggRate = avgPlayCount > 0 ? avgDiggCount / avgPlayCount : 0
  const accountFit = args.matchedVideos.length > 0 ? 8 : 0

  const rawPotential =
    Math.log10(1 + avgPlayCount) * 12 +
    Math.min(diggRate, 0.2) * 120 -
    Math.log10(1 + avgCreatorFollowers) * 7 -
    Math.log10(1 + creatorCount) * 4 +
    accountFit -
    args.index * 1.2

  return {
    avgPlayCount: Math.round(avgPlayCount),
    totalPlayCount: Math.round(totalPlayCount),
    sampleVideoCount,
    creatorCount,
    playPerCreator: Math.round(avgCreatorFollowers),
    avgDiggCount: Math.round(avgDiggCount),
    potentialScore: rawPotential,
  }
}

/** 同批候选相对拉开潜力到约 28–92，避免旧公式顶满后人人 100 */
function rescalePotentialScores(candidates: TrackCandidateInsert[]): TrackCandidateInsert[] {
  const scored = candidates
    .map((candidate, index) => ({ candidate, index, raw: candidate.metrics?.potentialScore }))
    .filter((item): item is { candidate: TrackCandidateInsert; index: number; raw: number } =>
      typeof item.raw === 'number' && Number.isFinite(item.raw),
    )

  if (scored.length === 0) return candidates

  const raws = scored.map((item) => item.raw)
  const min = Math.min(...raws)
  const max = Math.max(...raws)
  const span = max - min

  return candidates.map((candidate, index) => {
    const hit = scored.find((item) => item.index === index)
    if (!hit || !candidate.metrics) return candidate

    let potentialScore: number
    if (span < 0.35) {
      potentialScore = clampScore(58 - hit.index * 5)
    } else {
      potentialScore = clampScore(28 + ((hit.raw - min) / span) * 64)
    }

    return {
      ...candidate,
      potentialScore,
      metrics: {
        ...candidate.metrics,
        potentialScore,
      },
      reason: candidate.metrics
        ? `基于抖音搜索样本（本页 ${String(candidate.metrics.sampleVideoCount)} 条）：均播 ${String(candidate.metrics.avgPlayCount)}、作者均粉 ${String(candidate.metrics.playPerCreator)}、样本创作者 ${String(candidate.metrics.creatorCount)}；潜力为同批相对分（非绝对满分）。`
        : candidate.reason,
    }
  })
}

async function loadMarket(
  tikhub: TikHubService,
  searchQuery: string,
  cache: Map<string, { videos: DouyinSearchVideoItem[]; users: DouyinSearchUserItem[] }>,
): Promise<{ videos: DouyinSearchVideoItem[]; users: DouyinSearchUserItem[] }> {
  const cached = cache.get(searchQuery)
  if (cached) return cached

  let videos: DouyinSearchVideoItem[] = []
  let users: DouyinSearchUserItem[] = []
  try {
    videos = await tikhub.searchVideos(searchQuery, { sortType: '1' })
  } catch {
    videos = []
  }
  const needUsers =
    videos.length === 0 ||
    videos.every((item) => item.authorFollowerCount <= 0 && !item.authorAvatarUrl)
  if (needUsers) {
    try {
      users = await tikhub.searchUsers(searchQuery)
    } catch {
      users = []
    }
  }

  const payload = { videos, users }
  cache.set(searchQuery, payload)
  return payload
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index]!, index)
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  await Promise.all(runners)
  return results
}

function rankingScore(
  candidate: TrackCandidateInsert,
  matchCount: number,
): number {
  const sample = candidate.metrics?.sampleVideoCount ?? 0
  const potential = candidate.potentialScore ?? 0
  const sampleBoost = sample >= 6 ? 18 : sample > 0 ? 8 : 0
  return matchCount * 22 + potential * 0.7 + sampleBoost
}

/** 按账号契合 + 市场信号重排；弱候选在已有足够好结果时剔除 */
function rerankAndFilter(
  candidates: TrackCandidateInsert[],
  matchCounts: number[],
): TrackCandidateInsert[] {
  const ranked = candidates
    .map((candidate, index) => ({
      candidate,
      matchCount: matchCounts[index] ?? 0,
      score: rankingScore(candidate, matchCounts[index] ?? 0),
    }))
    .sort((a, b) => b.score - a.score || b.matchCount - a.matchCount)

  const kept: typeof ranked = []
  for (const item of ranked) {
    const weak =
      (item.candidate.metrics?.sampleVideoCount ?? 0) <= 0 && item.matchCount <= 0
    if (weak && kept.length >= 6) continue
    kept.push(item)
  }

  const finalList = kept.length > 0 ? kept : ranked.slice(0, Math.min(8, ranked.length))
  return finalList.map((item, index) => ({
    ...item.candidate,
    sortOrder: index,
  }))
}

/** 用 TikHub 搜索结果写入确切市场指标、证据与代表红人 */
export async function enrichTrackCandidatesWithMarket(args: {
  tikhub: TikHubService
  account: DouyinAccount
  accountVideos: DouyinVideoItem[]
  candidates: TrackCandidateInsert[]
}): Promise<TrackCandidateInsert[]> {
  const cache = new Map<string, { videos: DouyinSearchVideoItem[]; users: DouyinSearchUserItem[] }>()

  const enriched = await mapPool(
    args.candidates,
    MARKET_CONCURRENCY,
    async (candidate, index) => {
      const searchQuery = buildSearchQuery(candidate.name, candidate.searchHint)
      const market = await loadMarket(args.tikhub, searchQuery, cache)

      const matchedVideos = matchAccountVideos(args.accountVideos, candidate.name, searchQuery)
      const fromVideos = influencersFromVideos(market.videos).filter(
        (item) => item.followerCount > 0 || Boolean(item.avatarUrl) || Boolean(item.uniqueId),
      )
      const fromUsers = influencersFromUsers(market.users, searchQuery).filter(
        (item) => item.followerCount > 0 || Boolean(item.avatarUrl) || Boolean(item.uniqueId),
      )
      const seenInfluencers = new Set<string>()
      const finalInfluencers: TrackInfluencer[] = []
      for (const item of [...fromVideos, ...fromUsers]) {
        const key = (item.uniqueId || item.nickname).toLowerCase()
        if (!key || seenInfluencers.has(key)) continue
        seenInfluencers.add(key)
        finalInfluencers.push(item)
        if (finalInfluencers.length >= 6) break
      }

      const metrics =
        market.videos.length > 0
          ? metricsFromMarket({ matchedVideos, market: market.videos, index })
          : null

      const evidence: string[] = []
      if (matchedVideos.length > 0) {
        for (const video of matchedVideos.slice(0, 2)) {
          evidence.push(
            `账号近作（${formatPlayLabel(video)}·赞${String(video.diggCount)}·评${String(video.commentCount)}）：${video.description.slice(0, 36)}${video.description.length > 36 ? '…' : ''}`,
          )
        }
      } else {
        evidence.push(
          `账号近作暂无明显「${searchQuery}」命中，建议下一轮主动露出该方向词。`,
        )
      }

      if (metrics) {
        evidence.push(
          `抖音搜索「${searchQuery}」本页样本 ${String(metrics.sampleVideoCount)} 条：均播 ${String(metrics.avgPlayCount)}，作者均粉 ${String(metrics.playPerCreator)}，样本创作者 ${String(metrics.creatorCount)} 人（非全站总量）`,
        )
        const top = market.videos[0]
        if (top) {
          evidence.push(
            `赛道热帖：@${top.authorNickname}（粉${String(top.authorFollowerCount)}）·${formatPlayLabel(top)}·赞${String(top.diggCount)}·「${top.description.slice(0, 24)}${top.description.length > 24 ? '…' : ''}」`,
          )
        }
      } else if (market.users.length > 0) {
        evidence.push(
          `用户搜索「${searchQuery}」命中 ${String(market.users.length)} 个相关账号，可作对标。`,
        )
      } else {
        evidence.push(`暂未检索到「${searchQuery}」稳定样本，请检查 TikHub 后重试校准。`)
      }

      const next: TrackCandidateInsert = {
        ...candidate,
        searchHint: searchQuery,
        heatScore: metrics?.avgPlayCount ?? candidate.heatScore,
        competitionScore: metrics?.playPerCreator ?? candidate.competitionScore,
        potentialScore: metrics?.potentialScore ?? candidate.potentialScore,
        metrics,
        evidence: evidence.slice(0, 5),
        influencers: finalInfluencers,
        reason: metrics
          ? `基于抖音搜索「${searchQuery}」本页样本 ${String(metrics.sampleVideoCount)} 条：均播 ${String(metrics.avgPlayCount)}、作者均粉 ${String(metrics.playPerCreator)}、样本创作者 ${String(metrics.creatorCount)}。`
          : candidate.reason,
      }
      return { candidate: next, matchCount: matchedVideos.length }
    },
  )

  const rescaled = rescalePotentialScores(enriched.map((item) => item.candidate))
  const matchCounts = enriched.map((item) => item.matchCount)
  return rerankAndFilter(rescaled, matchCounts)
}
