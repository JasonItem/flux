export const JobChannels = {
  list: 'jobs:list',
  enqueue: 'jobs:enqueue',
  cancel: 'jobs:cancel',
  clearFinished: 'jobs:clearFinished',
  changed: 'jobs:changed',
} as const

export type JobKind = 'research.dissect' | 'media.download' | 'workshop.replicate'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type JobPhase =
  | 'queued'
  | 'downloading'
  | 'deps'
  | 'transcribing'
  | 'analyzing'
  | 'ready'
  | 'error'
  | 'idle'

export interface StudioJob {
  id: string
  kind: JobKind
  title: string
  status: JobStatus
  phase: JobPhase
  message: string
  percent: number | null
  href: string
  /** Stable key for dedupe, e.g. research.dissect:{videoId} */
  dedupeKey: string
  payload: Record<string, unknown>
  error: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export interface JobEnqueueInput {
  kind: JobKind
  title: string
  href: string
  dedupeKey: string
  payload?: Record<string, unknown>
  /** When true, always create a new job even if one is active/succeeded */
  force?: boolean
}

export interface JobsChangedEvent {
  jobs: StudioJob[]
  /** Job ids that newly entered a terminal state since last emit (for toasts) */
  justFinished: Array<{ id: string; status: 'succeeded' | 'failed' | 'cancelled' }>
}

export interface JobsApi {
  list: () => Promise<StudioJob[]>
  enqueue: (input: JobEnqueueInput) => Promise<StudioJob>
  cancel: (id: string) => Promise<StudioJob | null>
  clearFinished: () => Promise<StudioJob[]>
  onChanged: (callback: (event: JobsChangedEvent) => void) => () => void
}

export function researchDissectDedupeKey(videoId: string): string {
  return `research.dissect:${videoId}`
}

export function mediaDownloadDedupeKey(researchVideoId: string): string {
  return `media.download:${researchVideoId}`
}

export function workshopReplicateJobDedupeKey(researchVideoId: string): string {
  return `workshop.replicate:${researchVideoId}`
}
