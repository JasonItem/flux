export const TrackChannels = {
  listAssessments: 'track:listAssessments',
  getAssessment: 'track:getAssessment',
  startAssessment: 'track:startAssessment',
  deleteAssessment: 'track:deleteAssessment',
} as const

export type TrackAssessmentStatus = 'running' | 'ready' | 'failed'

export interface TrackInfluencer {
  nickname: string
  uniqueId: string | null
  avatarUrl: string | null
  signature: string | null
  followerCount: number
  awemeCount: number
  highlight: string
  profileUrl: string
}

/** 赛道市场实测指标（来自抖音搜索样本，不是含糊打分） */
export interface TrackMarketMetrics {
  /** 样本平均播放量 */
  avgPlayCount: number
  /** 样本总播放量 */
  totalPlayCount: number
  /** 本页搜索样本条数（不是全站作品总量） */
  sampleVideoCount: number
  /** 样本内去重创作者数 */
  creatorCount: number
  /**
   * 竞争代理：样本作者平均粉丝数。
   * （历史字段名 playPerCreator；一人一条样本时「总播/作者数」≈均播，已弃用）
   */
  playPerCreator: number
  /** 样本平均点赞 */
  avgDiggCount: number
  /**
   * 潜力 1–100：同批候选相对分。
   * 均播/互动率高 → 升；作者均粉高、创作者过多 → 降；账号已有相关近作 → 升。
   */
  potentialScore: number
}

export interface TrackCandidate {
  id: string
  assessmentId: string
  name: string
  summary: string
  /** @deprecated 兼容旧字段：现表示均播量（取整） */
  heatScore: number
  /** @deprecated 兼容旧字段：现表示作者均粉（取整） */
  competitionScore: number
  /** 潜力分 1–100 */
  potentialScore: number
  metrics: TrackMarketMetrics | null
  reason: string
  evidence: string[]
  influencers: TrackInfluencer[]
  sortOrder: number
  addedAsTopic: boolean
}

export interface TrackCompositionItem {
  label: string
  share: number
  signal: string
}

export interface TrackDiagnosis {
  positioning: string
  composition: TrackCompositionItem[]
  strengths: string[]
  weaknesses: string[]
}

export interface TrackAssessment {
  id: string
  accountId: string
  accountNickname: string
  accountAvatarUrl: string | null
  status: TrackAssessmentStatus
  diagnosis: TrackDiagnosis | null
  candidates: TrackCandidate[]
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface TrackAssessmentSummary {
  id: string
  accountId: string
  accountNickname: string
  status: TrackAssessmentStatus
  candidateCount: number
  createdAt: string
  updatedAt: string
}

export interface TrackGetAssessmentOptions {
  /** 默认 true；进入页面读取历史时传 false，避免误以为又在自测 */
  enrich?: boolean
}

export interface TrackApi {
  listAssessments: (accountId?: string) => Promise<TrackAssessmentSummary[]>
  getAssessment: (id: string, options?: TrackGetAssessmentOptions) => Promise<TrackAssessment>
  startAssessment: (accountId?: string) => Promise<TrackAssessment>
  deleteAssessment: (id: string) => Promise<void>
}
