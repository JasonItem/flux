import type { AccountAnalysisApi } from './accountAnalysis'
import type { CleanupApi } from './cleanup'
import type { LlmApi } from './llm'
import type { TikHubApi } from './tikhub'
import type { JobsApi } from './jobs'
import type { MediaApi } from './media'
import type { ResearchApi } from './research'
import type { TopicApi } from './topic'
import type { TrackApi } from './track'
import type { WorkshopApi } from './workshop'

export { CleanupChannels } from './cleanup'
export type {
  CleanupActionResult,
  CleanupApi,
  CleanupSizeItem,
  CleanupStatus,
  CleanupUsageKeepDays,
} from './cleanup'

export { LlmChannels } from './llm'
export type {
  LlmApi,
  LlmChatInput,
  LlmChatMessage,
  LlmChatResult,
  LlmChatRole,
  LlmChatUsage,
  LlmModel,
  LlmModelCreateInput,
  LlmModelUpdateInput,
  LlmProvider,
  LlmProviderCreateInput,
  LlmProviderUpdateInput,
  LlmStreamChunkEvent,
  LlmStreamEndEvent,
  LlmStreamErrorEvent,
  LlmStreamHandlers,
  LlmStreamStartResult,
  LlmRemoteModel,
  LlmUsageDayStat,
  LlmUsageModelStat,
  LlmUsageRecord,
  LlmUsageStats,
} from './llm'

export { TikHubChannels } from './tikhub'
export type {
  DouyinAccount,
  DouyinAccountPreview,
  DouyinVideoItem,
  DouyinVideoPage,
  TikHubApi,
  TikHubBalanceStatus,
  TikHubCallRecord,
  TikHubConnectionTestResult,
  TikHubSettings,
  TikHubSettingsUpdateInput,
  TikHubUsageDayStat,
  TikHubUsageOverview,
} from './tikhub'
export { TikHubSettingsChangedEvent } from './tikhub'

export { TrackChannels } from './track'
export type {
  TrackApi,
  TrackAssessment,
  TrackAssessmentStatus,
  TrackAssessmentSummary,
  TrackCandidate,
  TrackCompositionItem,
  TrackDiagnosis,
  TrackInfluencer,
  TrackMarketMetrics,
} from './track'

export { TopicChannels } from './topic'
export type {
  TopicApi,
  TopicItem,
  TopicManualInput,
  TopicStatus,
  TopicUpdateInput,
} from './topic'

export { ResearchChannels } from './research'
export type {
  ResearchAnalyzeResult,
  ResearchApi,
  ResearchCommentItem,
  ResearchDissectByUrlInput,
  ResearchDissectByUrlResult,
  ResearchDissectRecordsQuery,
  ResearchDissectRecordsResult,
  ResearchScriptSegment,
  ResearchStructureBlock,
  ResearchVideoDetail,
  ResearchVideoStatus,
  ResearchVideoSummary,
  ResearchVideoType,
} from './research'

export { WorkshopChannels, workshopScriptHref } from './workshop'
export type {
  WorkshopApi,
  WorkshopProgressEvent,
  WorkshopScriptDetail,
  WorkshopScriptSegment,
  WorkshopScriptStatus,
  WorkshopScriptSummary,
  WorkshopScriptUpdateInput,
} from './workshop'

export { JobChannels } from './jobs'
export type {
  JobEnqueueInput,
  JobKind,
  JobPhase,
  JobStatus,
  JobsApi,
  JobsChangedEvent,
  StudioJob,
} from './jobs'

export { AccountAnalysisChannels } from './accountAnalysis'
export type {
  AccountAnalysisApi,
  AccountAnalysisDetail,
  AccountAnalysisDiagnosis,
  AccountAnalysisMetrics,
  AccountAnalysisStatus,
  AccountAnalysisVideoRow,
  AccountPerformanceTag,
  AccountPortraitBlock,
  AccountPortraitBundle,
  AccountPortraitSlice,
  AccountTopicPlan,
  AccountVideoAnalysis,
  AccountVideoComment,
  AccountVideoType,
  AccountWorkCollection,
} from './accountAnalysis'

export const DatabaseStatusChannel = 'db:status'

export const WindowChannels = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  isMaximized: 'window:is-maximized',
  maximizedChanged: 'window:maximized-changed',
} as const

export interface DatabaseStatus {
  ready: boolean
  path: string
  schemaVersion: number
  appliedMigrations: string[]
  error?: string
}

export interface WindowControlsApi {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
}

export interface StudioApi {
  getDatabaseStatus: () => Promise<DatabaseStatus>
  window: WindowControlsApi
  llm: LlmApi
  tikhub: TikHubApi
  track: TrackApi
  topic: TopicApi
  research: ResearchApi
  workshop: WorkshopApi
  media: MediaApi
  jobs: JobsApi
  accountAnalysis: AccountAnalysisApi
  cleanup: CleanupApi
}
