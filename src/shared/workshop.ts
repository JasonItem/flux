import type { StudioJob } from './jobs'
import type { ResearchVideoType } from './research'

export const WorkshopChannels = {
  listScripts: 'workshop:listScripts',
  getScript: 'workshop:getScript',
  updateScript: 'workshop:updateScript',
  deleteScript: 'workshop:deleteScript',
  enqueueReplicate: 'workshop:enqueueReplicate',
  progress: 'workshop:progress',
} as const

export type WorkshopScriptStatus = 'draft' | 'generating' | 'ready' | 'error'

export interface WorkshopScriptSegment {
  order: number
  title: string
  purpose: string
  /** 建议口播时长（秒），非原片时间码 */
  beatSec: number
  /** 可直接录制的口播文案 */
  spokenText: string
  /** 为什么这样写 */
  why: string
  /** 剪辑/画面提示 */
  editHint: string
  /** 原片参考短句（只读对照） */
  sourceKeyLines: string[]
}

export interface WorkshopScriptSummary {
  id: string
  title: string
  status: WorkshopScriptStatus
  sourceResearchVideoId: string | null
  sourceTitle: string | null
  topicId: string | null
  topicTitle: string
  videoType: ResearchVideoType | string
  angle: string
  durationHintSec: number
  segmentCount: number
  summary: string
  createdAt: string
  updatedAt: string
}

export interface WorkshopScriptDetail extends WorkshopScriptSummary {
  sourceAwemeId: string | null
  segments: WorkshopScriptSegment[]
  hooks: string[]
  ctaOptions: string[]
  commentInsights: string[]
  fullScriptText: string
  error: string | null
}

export interface WorkshopScriptUpdateInput {
  id: string
  title?: string
  angle?: string
  summary?: string
  segments?: WorkshopScriptSegment[]
  hooks?: string[]
  ctaOptions?: string[]
  commentInsights?: string[]
}

export interface WorkshopProgressEvent {
  scriptId: string
  researchVideoId?: string | null
  phase: 'queued' | 'analyzing' | 'ready' | 'error'
  message: string
  percent?: number
}

export interface WorkshopApi {
  listScripts: () => Promise<WorkshopScriptSummary[]>
  getScript: (id: string) => Promise<WorkshopScriptDetail>
  updateScript: (input: WorkshopScriptUpdateInput) => Promise<WorkshopScriptDetail>
  deleteScript: (id: string) => Promise<void>
  /** 从已拆解样本复刻口播脚本（后台任务） */
  enqueueReplicate: (
    researchVideoId: string,
    options?: { force?: boolean },
  ) => Promise<StudioJob>
  onProgress: (callback: (event: WorkshopProgressEvent) => void) => () => void
}

export function workshopReplicateDedupeKey(researchVideoId: string): string {
  return `workshop.replicate:${researchVideoId}`
}

export function workshopScriptHref(id: string): `/workshop/${string}` {
  return `/workshop/${encodeURIComponent(id)}`
}

export function buildFullScriptText(segments: WorkshopScriptSegment[]): string {
  return segments
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((seg) => `【${seg.title} · ${seg.purpose}】\n${seg.spokenText.trim()}`)
    .filter((block) => block.trim().length > 0)
    .join('\n\n')
}
