import type {
  AccountAnalysisMetrics,
  AccountAnalysisVideoRow,
  AccountPerformanceTag,
  AccountVideoType,
} from '../../shared/accountAnalysis'
import type { DouyinVideoItem } from '../../shared/tikhub'

const TYPE_RULES: Array<{ type: AccountVideoType; words: string[] }> = [
  { type: '教程', words: ['教程', '步骤', '怎么', '方法', '教你', '清单', '公式'] },
  { type: '口播', words: ['我说', '分享', '告诉你', '注意', '干货', '避坑'] },
  { type: '带货', words: ['链接', '下单', '优惠', '到手价', '推荐买'] },
  { type: '探店', words: ['探店', '打卡', '这家', '地址', '人均'] },
  { type: '剧情', words: ['反转', '结局', '剧本', '故事'] },
  { type: '资讯', words: ['资讯', '新闻', '政策', '最新'] },
]

export function estimatedPlay(item: { playCount: number; diggCount: number }): number {
  if (item.playCount > 0) return item.playCount
  return Math.max(0, item.diggCount) * 25
}

export function classifyVideoType(text: string): AccountVideoType {
  const corpus = text.toLowerCase()
  let best: { type: AccountVideoType; score: number } | null = null
  for (const rule of TYPE_RULES) {
    const score = rule.words.reduce(
      (sum, word) => sum + (corpus.includes(word.toLowerCase()) ? 1 : 0),
      0,
    )
    if (score > 0 && (!best || score > best.score)) best = { type: rule.type, score }
  }
  return best?.type ?? '口播'
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2
  }
  return sorted[mid]!
}

function tagFromScore(score: number, p70: number, p30: number): AccountPerformanceTag {
  if (score >= p70) return 'high'
  if (score <= p30) return 'low'
  return 'mid'
}

export function buildVideoRows(videos: DouyinVideoItem[]): AccountAnalysisVideoRow[] {
  const scored = videos.map((item) => {
    const est = estimatedPlay(item)
    const engagement = item.diggCount + item.commentCount + item.shareCount
    const weight = est + engagement * 8
    return { item, est, weight }
  })
  const weights = scored.map((row) => row.weight)
  const maxWeight = Math.max(...weights, 1)
  const sortedWeights = [...weights].sort((a, b) => a - b)
  const p70 = sortedWeights[Math.floor((sortedWeights.length - 1) * 0.7)] ?? maxWeight
  const p30 = sortedWeights[Math.floor((sortedWeights.length - 1) * 0.3)] ?? 0

  return scored.map(({ item, est, weight }) => {
    const relativeScore = Math.max(1, Math.min(100, Math.round((weight / maxWeight) * 100)))
    const title = item.description?.trim() || '未命名作品'
    return {
      awemeId: item.awemeId,
      title,
      coverUrl: item.coverUrl,
      playUrl: item.playUrl,
      profileUrl: item.awemeId
        ? `https://www.douyin.com/video/${item.awemeId}`
        : '',
      createTime: item.createTime,
      durationSec: item.durationMs ? Math.max(1, Math.round(item.durationMs / 1000)) : 0,
      diggCount: item.diggCount,
      commentCount: item.commentCount,
      shareCount: item.shareCount,
      playCount: item.playCount,
      estimatedPlay: est,
      relativeScore,
      videoType: classifyVideoType(title),
      performanceTag: tagFromScore(weight, p70, p30),
      collectionId: null,
    }
  })
}

export function buildMetrics(rows: AccountAnalysisVideoRow[]): AccountAnalysisMetrics {
  const count = rows.length
  if (count === 0) {
    return {
      videoCount: 0,
      avgEstimatedPlay: 0,
      avgDigg: 0,
      avgComment: 0,
      avgShare: 0,
      avgEngagementRate: 0,
      medianPostIntervalDays: null,
      avgDurationSec: 0,
    }
  }

  const sumPlay = rows.reduce((sum, row) => sum + row.estimatedPlay, 0)
  const sumDigg = rows.reduce((sum, row) => sum + row.diggCount, 0)
  const sumComment = rows.reduce((sum, row) => sum + row.commentCount, 0)
  const sumShare = rows.reduce((sum, row) => sum + row.shareCount, 0)
  const sumDuration = rows.reduce((sum, row) => sum + row.durationSec, 0)
  const engagementRates = rows.map((row) => {
    const denom = Math.max(row.estimatedPlay, 1)
    return (row.diggCount + row.commentCount + row.shareCount) / denom
  })

  const times = rows
    .map((row) => row.createTime)
    .filter((value): value is number => typeof value === 'number' && value > 0)
    .sort((a, b) => b - a)
  const intervals: number[] = []
  for (let i = 0; i < times.length - 1; i += 1) {
    const diffSec = times[i]! - times[i + 1]!
    if (diffSec > 0) intervals.push(diffSec / 86_400)
  }

  return {
    videoCount: count,
    avgEstimatedPlay: Math.round(sumPlay / count),
    avgDigg: Math.round(sumDigg / count),
    avgComment: Math.round(sumComment / count),
    avgShare: Math.round(sumShare / count),
    avgEngagementRate: Number(
      (engagementRates.reduce((sum, rate) => sum + rate, 0) / count).toFixed(4),
    ),
    medianPostIntervalDays: median(intervals),
    avgDurationSec: Math.round(sumDuration / count),
  }
}
