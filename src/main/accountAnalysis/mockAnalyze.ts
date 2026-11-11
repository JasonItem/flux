import { randomUUID } from 'node:crypto'

import type {
  AccountAnalysisDiagnosis,
  AccountAnalysisMetrics,
  AccountAnalysisVideoRow,
  AccountPortraitBlock,
  AccountPortraitBundle,
  AccountPortraitSlice,
  AccountTopicPlan,
  AccountVideoAnalysis,
  AccountVideoComment,
  AccountWorkCollection,
} from '../../shared/accountAnalysis'
import type { DouyinAccount } from '../../shared/tikhub'

function formatDays(days: number | null): string {
  if (days == null || !Number.isFinite(days)) return '作品发布时间不足，暂无法判断节奏'
  if (days < 1.2) return `近作更新很快，中位间隔约 ${days.toFixed(1)} 天`
  if (days <= 3.5) return `发布节奏较稳，中位间隔约 ${days.toFixed(1)} 天`
  if (days <= 7) return `更新偏疏，中位间隔约 ${days.toFixed(1)} 天`
  return `更新间隔偏长（约 ${days.toFixed(1)} 天）`
}

function durationInsight(avgSec: number, rows: AccountAnalysisVideoRow[]): string {
  if (rows.length === 0) return '暂无作品时长数据'
  if (avgSec <= 0) return '作品时长缺失'
  if (avgSec < 25) return `内容偏短（均值 ${String(avgSec)} 秒），适合强钩子快信息`
  if (avgSec > 90) return `内容偏长（均值 ${String(avgSec)} 秒），需强化前 3 秒`
  return `时长落在常见区间（均值 ${String(avgSec)} 秒）`
}

function stageLabel(metrics: AccountAnalysisMetrics, rows: AccountAnalysisVideoRow[]): string {
  if (rows.length < 5) return '冷启'
  const high = rows.filter((row) => row.performanceTag === 'high').length
  const low = rows.filter((row) => row.performanceTag === 'low').length
  const ratio = high / Math.max(rows.length, 1)
  const lowRatio = low / Math.max(rows.length, 1)
  if (metrics.medianPostIntervalDays != null && metrics.medianPostIntervalDays > 10) return '下滑'
  if (lowRatio >= 0.45 && ratio < 0.2) return '下滑'
  if (ratio >= 0.25 && lowRatio <= 0.25) return '稳定'
  return '波动'
}

/** 体裁/互动词，不能当「兴趣」 */
const VIDEO_FORMAT_LABELS = new Set([
  '口播',
  '带货',
  '探店',
  '教程',
  '剧情',
  '资讯',
  '其他',
  '混剪',
  'Vlog',
  'vlog',
])

function looksLikeRawComment(text: string): boolean {
  if (text.length > 18) return true
  if (/\[[^\]]+\]/.test(text)) return true
  if (/谢谢|老家|大表姐|加油|慕了|求链接|怎么做|666|哈哈哈/.test(text)) return true
  if (/^[\s\p{P}\p{S}]+$/u.test(text)) return true
  return false
}

/** 兴趣标签：受众关注主题，不是体裁、也不是原评论 */
export function sanitizeInterestLabels(labels: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of labels) {
    const label = raw.replace(/\s+/g, ' ').trim()
    if (!label || label.length < 2) continue
    if (VIDEO_FORMAT_LABELS.has(label)) continue
    if (looksLikeRawComment(label)) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label.slice(0, 16))
    if (out.length >= 5) break
  }
  return out
}

export function interestSlicesFromLabels(labels: string[]): AccountPortraitSlice[] {
  const clean = sanitizeInterestLabels(labels)
  const fallback = ['行业干货', '实操方法', '案例拆解']
  const finalLabels = clean.length > 0 ? clean : fallback
  const raw = finalLabels.map((label, index) => ({
    label,
    share: Math.max(12, 36 - index * 5),
  }))
  const total = raw.reduce((sum, item) => sum + item.share, 0) || 1
  return raw.map((item) => ({
    ...item,
    share: Math.round((item.share / total) * 100),
  }))
}

function extractTitleTopics(title: string): string[] {
  const text = title.trim()
  if (!text) return []
  const topics: string[] = []
  const patterns: Array<[RegExp, string]> = [
    [/跨境|外贸|出海/, '跨境外贸'],
    [/工厂|产业园|园区/, '工厂/园区'],
    [/选品|爆款/, '选品'],
    [/物流|报关|清关/, '物流报关'],
    [/创业|老板|团队/, '创业经营'],
    [/案例|实操|避坑/, '实操案例'],
    [/洛阳|本地/, '本地产业'],
  ]
  for (const [re, label] of patterns) {
    if (re.test(text)) topics.push(label)
  }
  return topics
}

function portraitBlock(summary: string, interests: string[]): AccountPortraitBlock {
  return {
    summary,
    gender: [
      { label: '偏男性决策者', share: 58 },
      { label: '偏女性运营/市场', share: 42 },
    ],
    age: [
      { label: '25–34', share: 46 },
      { label: '35–44', share: 32 },
      { label: '18–24', share: 22 },
    ],
    interests: interestSlicesFromLabels(interests),
    motivations: ['学方法避坑', '找可落地案例', '关注行业动态'],
    activeTraits: ['工作日晚间更活跃', '更愿意评论追问细节', '对清单/步骤类内容停留更久'],
  }
}

export function buildRuleAccountDiagnosis(input: {
  account: DouyinAccount
  metrics: AccountAnalysisMetrics
  videos: AccountAnalysisVideoRow[]
  trackName: string | null
}): AccountAnalysisDiagnosis {
  const { account, metrics, videos, trackName } = input
  const stage = stageLabel(metrics, videos)
  const high = videos.filter((row) => row.performanceTag === 'high')
  const low = videos.filter((row) => row.performanceTag === 'low')
  const typeCounts = new Map<string, number>()
  for (const row of videos) {
    typeCounts.set(row.videoType, (typeCounts.get(row.videoType) ?? 0) + 1)
  }
  const mix = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => `${type}${String(count)}条`)
    .join('、')

  const strengths: string[] = []
  const weaknesses: string[] = []
  if (high.length > 0) {
    strengths.push(`近作有 ${String(high.length)} 条相对高光，互动高于本批均值`)
  }
  if (metrics.avgEngagementRate >= 0.05) {
    strengths.push(`平均互动率约 ${(metrics.avgEngagementRate * 100).toFixed(1)}%`)
  }
  if (strengths.length === 0) strengths.push('已有公开作品样本，可继续用数据校准选题')

  if (low.length > 0) weaknesses.push(`有 ${String(low.length)} 条相对拖后腿，需复查封面与开头`)
  if (metrics.avgEngagementRate > 0 && metrics.avgEngagementRate < 0.03) {
    weaknesses.push('互动率偏低，可加强评论引导')
  }
  if (weaknesses.length === 0) weaknesses.push('样本内差异不大，需要系列选题拉开辨识度')

  let trackAlignment: string | null = null
  if (trackName) {
    const hit = videos.filter((row) => row.title.includes(trackName.slice(0, 4))).length
    trackAlignment =
      hit >= Math.max(2, Math.floor(videos.length * 0.2))
        ? `近作与赛道「${trackName}」有一定重合`
        : `已选赛道「${trackName}」，近作标题重合偏少`
  }

  return {
    stageLabel: stage,
    positioning: `${account.nickname} 近 ${String(metrics.videoCount)} 条公开作品：阶段偏「${stage}」，类型以 ${mix || '综合'} 为主。`,
    strengths: strengths.slice(0, 4),
    weaknesses: weaknesses.slice(0, 4),
    postingCadence: formatDays(metrics.medianPostIntervalDays),
    durationInsight: durationInsight(metrics.avgDurationSec, videos),
    trackAlignment,
  }
}

export function buildRulePortraitBundle(input: {
  account: DouyinAccount
  videos: AccountAnalysisVideoRow[]
  commentSnippets: string[]
  trackName: string | null
}): AccountPortraitBundle {
  const titleTopics = input.videos.flatMap((item) => extractTitleTopics(item.title))
  const interests = sanitizeInterestLabels([
    ...(input.trackName ? [input.trackName] : []),
    ...titleTopics,
    '跨境/外贸干货',
    '工厂出海',
    '实操方法',
    '案例避坑',
  ])
  const commentHint =
    input.commentSnippets.length > 0
      ? '评论里常见追问细节、求案例，说明观众偏实操导向'
      : '评论样本不足，主要依据作品标题与赛道推断'

  return {
    note: '基于公开作品与评论的推断，非创作者中心官方画像。',
    audience: portraitBlock(
      `潜在观众更可能是寻找「${interests[0] || '行业干货'}」的从业者；${commentHint}`,
      interests,
    ),
    fans: portraitBlock(
      `更可能转粉的人，通常需要可复用的方法论，并对「${input.account.nickname}」的连续输出有信任感`,
      interests,
    ),
  }
}

export function buildRuleCollections(
  videos: AccountAnalysisVideoRow[],
): { collections: AccountWorkCollection[]; videos: AccountAnalysisVideoRow[] } {
  const byType = new Map<string, AccountAnalysisVideoRow[]>()
  for (const video of videos) {
    const list = byType.get(video.videoType) ?? []
    list.push(video)
    byType.set(video.videoType, list)
  }
  const ranked = [...byType.entries()].sort((a, b) => b[1].length - a[1].length)
  const collections: AccountWorkCollection[] = ranked.slice(0, 6).map(([type, rows]) => {
    const id = randomUUID()
    const sorted = [...rows].sort((a, b) => b.relativeScore - a.relativeScore)
    return {
      id,
      name: `${type}内容集`,
      share: Math.round((rows.length / Math.max(videos.length, 1)) * 100),
      audienceHint: `更适合关注「${type}」方法论与案例的观众`,
      awemeIds: sorted.map((item) => item.awemeId),
      coverUrl: sorted[0]?.coverUrl ?? null,
    }
  })

  const collectionByAweme = new Map<string, string>()
  for (const collection of collections) {
    for (const awemeId of collection.awemeIds) {
      collectionByAweme.set(awemeId, collection.id)
    }
  }

  return {
    collections,
    videos: videos.map((item) => ({
      ...item,
      collectionId: collectionByAweme.get(item.awemeId) ?? null,
    })),
  }
}

export function buildRuleTopicPlans(input: {
  account: DouyinAccount
  videos: AccountAnalysisVideoRow[]
  trackName: string | null
  portrait: AccountPortraitBundle
}): AccountTopicPlan[] {
  const high = input.videos.filter((item) => item.performanceTag === 'high')
  const seed = high[0]?.title.slice(0, 16) || input.trackName || '行业干货'
  const audience =
    input.portrait.audience.interests[0]?.label ||
    input.portrait.audience.summary.slice(0, 24) ||
    '目标从业者'

  return [
    {
      id: randomUUID(),
      title: `${seed}：可复用的 3 步清单`,
      targetAudience: audience,
      reason: '高光作品常见「清单/步骤」结构，易评论追问，适合系列化',
      evidence: high.slice(0, 2).map((item) => item.title.slice(0, 24)),
    },
    {
      id: randomUUID(),
      title: `避坑：${input.account.nickname} 视角下的常见误区`,
      targetAudience: `${audience}中的新手与转型者`,
      reason: '对比高光与拖后腿作品，问题向内容更容易拉动评论',
      evidence: input.videos
        .filter((item) => item.performanceTag === 'low')
        .slice(0, 2)
        .map((item) => item.title.slice(0, 24)),
    },
    {
      id: randomUUID(),
      title: input.trackName
        ? `围绕「${input.trackName}」的一周选题日历`
        : '一周 3 更：案例 / 清单 / 答疑',
      targetAudience: input.portrait.fans.summary.slice(0, 40) || '潜在铁粉',
      reason: '用固定栏目培养关注动机，对齐推断粉丝活跃特征',
      evidence: ['发布节奏结论', '粉丝关注动机'],
    },
  ]
}

export function buildRuleVideoAnalysis(input: {
  video: AccountAnalysisVideoRow
  commentSnippets: string[]
  comments?: AccountVideoComment[]
  accountPortrait: AccountPortraitBundle | null
}): AccountVideoAnalysis {
  const accountInterests = [
    ...(input.accountPortrait?.audience.interests.map((item) => item.label) ?? []),
    ...(input.accountPortrait?.fans.interests.map((item) => item.label) ?? []),
  ]
  const interests = sanitizeInterestLabels([
    ...extractTitleTopics(input.video.title),
    ...accountInterests,
    '行业干货',
    '实操方法',
    '案例拆解',
  ])
  const portrait = buildRulePortraitBundle({
    account: {
      id: '',
      secUserId: '',
      uid: null,
      uniqueId: null,
      nickname: '本视频',
      avatarUrl: null,
      signature: null,
      followerCount: 0,
      followingCount: 0,
      awemeCount: 0,
      totalFavorited: 0,
      profileUrl: null,
      sourceInput: '',
      isActive: false,
      createdAt: '',
      updatedAt: '',
    },
    videos: [input.video],
    commentSnippets: input.commentSnippets,
    trackName: null,
  })

  if (input.accountPortrait) {
    portrait.audience.summary = `本条更可能触达：${input.accountPortrait.audience.summary}`
    portrait.fans.summary = `对本条更可能转粉：${input.accountPortrait.fans.summary}`
  }

  const interestSlices = interestSlicesFromLabels(interests)
  portrait.audience.interests = interestSlices
  portrait.fans.interests = interestSlices

  return {
    awemeId: input.video.awemeId,
    title: input.video.title,
    coverUrl: input.video.coverUrl,
    playUrl: input.video.playUrl,
    profileUrl: input.video.profileUrl,
    portrait,
    commentThemes:
      input.commentSnippets.length > 0
        ? input.commentSnippets.slice(0, 5)
        : ['评论样本不足，暂以标题语义推断'],
    contentTips: [
      `强化「${input.video.videoType}」辨识：开头 3 秒点明受众与收获`,
      '中段用清单或对比降低跳出',
      '结尾抛一个可评论的具体问题',
    ],
    comments: input.comments ?? [],
    sampleCommentCount: (input.comments ?? []).length || input.commentSnippets.length,
    source: 'fallback',
    updatedAt: new Date().toISOString(),
  }
}
