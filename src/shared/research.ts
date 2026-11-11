import type { StudioJob } from './jobs'

export const ResearchChannels = {
  listVideos: 'research:listVideos',
  listDissectRecords: 'research:listDissectRecords',
  listCustomVideos: 'research:listCustomVideos',
  analyzeTopic: 'research:analyzeTopic',
  getVideo: 'research:getVideo',
  refreshVideo: 'research:refreshVideo',
  enrichTopicMedia: 'research:enrichTopicMedia',
  enrichVideoMedia: 'research:enrichVideoMedia',
  ensureLocalMedia: 'research:ensureLocalMedia',
  enqueueDissect: 'research:enqueueDissect',
  enqueueDissectByUrl: 'research:enqueueDissectByUrl',
  progress: 'research:progress',
} as const

export type ResearchVideoStatus = 'pending' | 'ready' | 'error'

export type ResearchMediaStatus = 'none' | 'downloading' | 'ready' | 'error'

export type ResearchDissectStatus =
  | 'pending'
  | 'downloading'
  | 'transcribing'
  | 'analyzing'
  | 'ready'
  | 'error'

export type ResearchVideoType =
  | '口播'
  | '带货'
  | '探店'
  | '教程'
  | '剧情'
  | '资讯'
  | '科普'
  | '其他'

export interface ResearchScriptSegment {
  label: string
  purpose: string
  text: string
}

export interface ResearchStructureBlock {
  startSec: number
  endSec: number
  title: string
  purpose: string
  /** 该时段的剪辑手法说明（不是整片一句话概括） */
  editingStyle: string
  /**
   * 对本段「原转写」的逻辑分析（为何这样讲、信息结构、转化意图），
   * 不是伪造口播台词。
   */
  analysis?: string
  /** 从原文摘出的关键短句（须能在转写中找到） */
  keyLines?: string[]
}

export interface ResearchTranscriptCue {
  startSec: number
  endSec: number
  text: string
}

export interface ResearchCommentItem {
  id: string
  author: string
  avatarUrl: string | null
  content: string
  diggCount: number
  replyCount: number
  replyRate: number
  qualityScore: number
  /** 子级回复（可无限嵌套）；列表默认收起 */
  replies: ResearchCommentItem[]
}

export interface ResearchVideoSummary {
  id: string
  topicId: string
  topicTitle: string
  title: string
  authorNickname: string
  authorUniqueId: string | null
  /** 抖音 aweme_id，用于拼视频页链接与补媒体 */
  awemeId: string | null
  coverUrl: string | null
  /**
   * 播放地址：优先本地 flux-media://；否则为 CDN。
   * 无本地缓存时走自定义协议，避免 CDN 过期/防盗链。
   */
  playUrl: string | null
  /** 本地落盘路径（主进程用）；渲染层一般只看 playUrl */
  localPath: string | null
  mediaStatus: ResearchMediaStatus
  dissectStatus: ResearchDissectStatus
  diggCount: number
  commentCount: number
  shareCount: number
  durationSec: number
  videoType: ResearchVideoType
  matchScore: number
  status: ResearchVideoStatus
  /** 优先为抖音视频页；缺省时可能是作者页 */
  profileUrl: string
  createdAt: string
  updatedAt: string
}

export interface ResearchVideoDetail extends ResearchVideoSummary {
  summary: string
  editingStyle: string
  scriptSegments: ResearchScriptSegment[]
  structureBlocks: ResearchStructureBlock[]
  comments: ResearchCommentItem[]
  takeaways: string[]
  /** ASR 得到的原视频完整文案 */
  fullTranscript: string
  /** 带时间戳的原文案分段 */
  transcriptCues: ResearchTranscriptCue[]
  dissectError: string | null
}

export interface ResearchProgressEvent {
  videoId: string
  awemeId?: string | null
  phase: ResearchDissectStatus | ResearchMediaStatus | 'idle'
  message: string
  percent?: number
}

export interface ResearchAnalyzeResult {
  videos: ResearchVideoSummary[]
  source: 'llm' | 'fallback'
  note?: string
}

export interface ResearchDissectRecordsQuery {
  page?: number
  pageSize?: number
  topicId?: string | null
}

export interface ResearchDissectRecordsResult {
  items: ResearchVideoSummary[]
  total: number
  page: number
  pageSize: number
}

export interface ResearchDissectByUrlInput {
  /** 抖音分享口令或视频链接 */
  url: string
  /** 归属选题；可空时后端会挂到「自定义拆解」选题 */
  topicId?: string | null
  /** 已存在时是否强制重新拆解 */
  force?: boolean
}

export interface ResearchDissectByUrlResult {
  video: ResearchVideoSummary
  job: StudioJob
  created: boolean
}

export interface ResearchApi {
  listVideos: (topicId: string) => Promise<ResearchVideoSummary[]>
  /** 已完成拆解的历史记录（跨选题，分页） */
  listDissectRecords: (
    query?: ResearchDissectRecordsQuery,
  ) => Promise<ResearchDissectRecordsResult>
  /** 自定义链接添加的拆解样本 */
  listCustomVideos: () => Promise<ResearchVideoSummary[]>
  analyzeTopic: (topicId: string) => Promise<ResearchAnalyzeResult>
  /** 已拆解则读本地缓存；否则下载→转写→LLM */
  getVideo: (id: string) => Promise<ResearchVideoDetail>
  /**
   * 已拆解：只同步点赞/评论/分享与评论样本；
   * 未拆解：入队完整拆解（下载/转写/大模型）。
   */
  refreshVideo: (id: string) => Promise<ResearchVideoDetail>
  /** 为缺封面/直链的样本补拉媒体，列表展示用 */
  enrichTopicMedia: (topicId: string) => Promise<ResearchVideoSummary[]>
  /** 补单条封面/直链（播放前刷新过期地址） */
  enrichVideoMedia: (id: string) => Promise<ResearchVideoSummary>
  /** 按需下载到本地并返回可播地址 */
  ensureLocalMedia: (id: string, options?: { force?: boolean }) => Promise<ResearchVideoSummary>
  /** 将拆解加入后台队列（不阻塞） */
  enqueueDissect: (id: string, options?: { force?: boolean }) => Promise<StudioJob>
  /** 粘贴抖音链接 → 建样本并入队拆解 */
  enqueueDissectByUrl: (input: ResearchDissectByUrlInput) => Promise<ResearchDissectByUrlResult>
  onProgress: (callback: (event: ResearchProgressEvent) => void) => () => void
}
