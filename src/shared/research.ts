export const ResearchChannels = {
  listVideos: 'research:listVideos',
  analyzeTopic: 'research:analyzeTopic',
  getVideo: 'research:getVideo',
  refreshVideo: 'research:refreshVideo',
  enrichTopicMedia: 'research:enrichTopicMedia',
  enrichVideoMedia: 'research:enrichVideoMedia',
} as const

export type ResearchVideoStatus = 'pending' | 'ready'

export type ResearchVideoType =
  | '口播'
  | '带货'
  | '探店'
  | '教程'
  | '剧情'
  | '资讯'
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
  /** 可直链播放地址；没有时播放器回退到封面 + 打开抖音页 */
  playUrl: string | null
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
}

export interface ResearchAnalyzeResult {
  videos: ResearchVideoSummary[]
  source: 'llm' | 'fallback'
  note?: string
}

export interface ResearchApi {
  listVideos: (topicId: string) => Promise<ResearchVideoSummary[]>
  analyzeTopic: (topicId: string) => Promise<ResearchAnalyzeResult>
  /** 已拆解则读本地缓存，不再打接口 */
  getVideo: (id: string) => Promise<ResearchVideoDetail>
  /** 强制重新补媒体并拆解 */
  refreshVideo: (id: string) => Promise<ResearchVideoDetail>
  /** 为缺封面/直链的样本补拉媒体，列表展示用 */
  enrichTopicMedia: (topicId: string) => Promise<ResearchVideoSummary[]>
  /** 补单条封面/直链（播放前刷新过期地址） */
  enrichVideoMedia: (id: string) => Promise<ResearchVideoSummary>
}
