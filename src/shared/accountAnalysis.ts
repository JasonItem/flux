export const AccountAnalysisChannels = {
  getAnalysis: 'accountAnalysis:getAnalysis',
  analyzeAccount: 'accountAnalysis:analyzeAccount',
  getVideoAnalysis: 'accountAnalysis:getVideoAnalysis',
  refreshVideoAnalysis: 'accountAnalysis:refreshVideoAnalysis',
} as const

export type AccountAnalysisStatus = 'pending' | 'ready' | 'failed'

export type AccountPerformanceTag = 'high' | 'mid' | 'low'

export type AccountVideoType =
  | '口播'
  | '带货'
  | '探店'
  | '教程'
  | '剧情'
  | '资讯'
  | '其他'

/** 推断画像中的标签切片 */
export interface AccountPortraitSlice {
  label: string
  /** 0–100 相对占比 */
  share: number
}

export interface AccountPortraitBlock {
  summary: string
  gender: AccountPortraitSlice[]
  age: AccountPortraitSlice[]
  interests: AccountPortraitSlice[]
  motivations: string[]
  activeTraits: string[]
}

export interface AccountPortraitBundle {
  /** 看过/互动过内容的潜在观众 */
  audience: AccountPortraitBlock
  /** 更可能关注账号的粉丝倾向 */
  fans: AccountPortraitBlock
  note: string
}

export interface AccountAnalysisDiagnosis {
  stageLabel: string
  positioning: string
  strengths: string[]
  weaknesses: string[]
  postingCadence: string
  durationInsight: string
  trackAlignment: string | null
}

export interface AccountWorkCollection {
  id: string
  name: string
  share: number
  audienceHint: string
  awemeIds: string[]
  coverUrl: string | null
}

export interface AccountTopicPlan {
  id: string
  title: string
  targetAudience: string
  reason: string
  evidence: string[]
}

export interface AccountAnalysisMetrics {
  videoCount: number
  avgEstimatedPlay: number
  avgDigg: number
  avgComment: number
  avgShare: number
  avgEngagementRate: number
  medianPostIntervalDays: number | null
  avgDurationSec: number
}

export interface AccountAnalysisVideoRow {
  awemeId: string
  title: string
  coverUrl: string | null
  playUrl: string | null
  profileUrl: string
  createTime: number | null
  durationSec: number
  diggCount: number
  commentCount: number
  shareCount: number
  playCount: number
  estimatedPlay: number
  relativeScore: number
  videoType: AccountVideoType
  performanceTag: AccountPerformanceTag
  collectionId: string | null
}

export interface AccountVideoComment {
  id: string
  author: string
  avatarUrl: string | null
  content: string
  diggCount: number
  replyCount: number
  replyRate: number
  qualityScore: number
  replies: AccountVideoComment[]
}

export interface AccountVideoAnalysis {
  awemeId: string
  title: string
  coverUrl: string | null
  playUrl: string | null
  profileUrl: string
  portrait: AccountPortraitBundle
  commentThemes: string[]
  contentTips: string[]
  /** 原始评论线程，供评论区展示 */
  comments: AccountVideoComment[]
  sampleCommentCount: number
  source: 'llm' | 'fallback'
  updatedAt: string
}

export interface AccountAnalysisDetail {
  id: string
  accountId: string
  accountNickname: string
  accountAvatarUrl: string | null
  status: AccountAnalysisStatus
  diagnosis: AccountAnalysisDiagnosis | null
  portrait: AccountPortraitBundle | null
  collections: AccountWorkCollection[]
  topicPlans: AccountTopicPlan[]
  metrics: AccountAnalysisMetrics | null
  videos: AccountAnalysisVideoRow[]
  /** 已拆解过的单视频分析缓存 */
  videoAnalyses: Record<string, AccountVideoAnalysis>
  source: 'llm' | 'fallback'
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface AccountAnalysisApi {
  getAnalysis: (accountId: string) => Promise<AccountAnalysisDetail | null>
  analyzeAccount: (accountId: string) => Promise<AccountAnalysisDetail>
  getVideoAnalysis: (accountId: string, awemeId: string) => Promise<AccountVideoAnalysis>
  refreshVideoAnalysis: (accountId: string, awemeId: string) => Promise<AccountVideoAnalysis>
}
