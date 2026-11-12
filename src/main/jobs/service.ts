import { BrowserWindow } from 'electron'

import type {
  JobEnqueueInput,
  JobPhase,
  JobsChangedEvent,
  StudioJob,
} from '../../shared/jobs'
import type { MediaService } from '../media/service'
import type { ResearchService } from '../research/service'
import type { WorkshopService } from '../workshop/service'
import type { JobRepository } from './repository'

export interface JobService {
  list: () => StudioJob[]
  enqueue: (input: JobEnqueueInput) => StudioJob
  cancel: (id: string) => StudioJob | null
  clearFinished: () => StudioJob[]
  resumeQueued: () => void
  /** Update the currently running job (or by id) from progress hooks */
  patchProgress: (
    jobId: string | null,
    patch: { phase?: JobPhase; message?: string; percent?: number | null },
  ) => void
}

function broadcast(event: JobsChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('jobs:changed', event)
  }
}

function mapResearchPhase(phase: string, message = ''): JobPhase {
  if (
    /Whisper|模型|引擎|提取音轨/.test(message) &&
    (phase === 'transcribing' || phase === 'downloading' || phase === 'extracting')
  ) {
    if (/提取音轨|转写/.test(message) && !/Whisper|模型|引擎/.test(message)) {
      return 'transcribing'
    }
    if (/Whisper|模型|引擎/.test(message)) return 'deps'
  }
  switch (phase) {
    case 'downloading':
    case 'refreshing':
      return 'downloading'
    case 'transcribing':
      return 'transcribing'
    case 'analyzing':
      return 'analyzing'
    case 'ready':
      return 'ready'
    case 'error':
      return 'error'
    case 'deps':
    case 'extracting':
      return 'deps'
    default:
      return 'idle'
  }
}

export function createJobService(input: {
  jobs: JobRepository
  getResearch: () => ResearchService
  getMedia: () => MediaService
  getWorkshop?: () => WorkshopService
}): JobService {
  const { jobs, getResearch, getMedia, getWorkshop } = input

  let pumping = false
  let currentJobId: string | null = null
  let currentAbort: AbortController | null = null
  const justFinished: JobsChangedEvent['justFinished'] = []

  const emitChanged = (finished?: JobsChangedEvent['justFinished']) => {
    if (finished?.length) justFinished.push(...finished)
    const batch = justFinished.splice(0, justFinished.length)
    broadcast({ jobs: jobs.list(), justFinished: batch })
  }

  const isAbortError = (error: unknown): boolean =>
    Boolean(
      error &&
        typeof error === 'object' &&
        'name' in error &&
        (error as { name?: string }).name === 'AbortError',
    )

  const runOne = async (job: StudioJob): Promise<void> => {
    currentJobId = job.id
    currentAbort = new AbortController()
    const signal = currentAbort.signal
    jobs.update(job.id, {
      status: 'running',
      phase: 'idle',
      message: '开始执行…',
      percent: 0,
      error: null,
      finishedAt: null,
    })
    emitChanged()

    try {
      if (job.kind === 'research.dissect') {
        const videoId = String(job.payload.videoId ?? '')
        if (!videoId) throw new Error('缺少 videoId')
        const force = Boolean(job.payload.force)
        await getResearch().runDissect(videoId, force, {
          signal,
          onProgress: (event) => {
            if (signal.aborted) return
            jobs.update(job.id, {
              phase: mapResearchPhase(String(event.phase), event.message),
              message: event.message,
              percent: event.percent ?? null,
            })
            emitChanged()
          },
        })
      } else if (job.kind === 'media.download') {
        const videoId = String(job.payload.videoId ?? '')
        if (!videoId) throw new Error('缺少 videoId')
        jobs.update(job.id, {
          phase: 'downloading',
          message: '正在下载视频到本地…',
          percent: 5,
        })
        emitChanged()
        await getMedia().ensureResearchVideo(videoId, {
          force: Boolean(job.payload.forceMedia),
        })
      } else if (job.kind === 'workshop.replicate') {
        const researchVideoId = String(job.payload.researchVideoId ?? '')
        const scriptId = String(job.payload.scriptId ?? '')
        if (!researchVideoId) throw new Error('缺少 researchVideoId')
        const workshop = getWorkshop?.()
        if (!workshop) throw new Error('创作工坊服务未就绪')
        await workshop.runReplicate(researchVideoId, scriptId || undefined, {
          onProgress: (event) => {
            if (signal.aborted) return
            jobs.update(job.id, {
              phase: event.phase === 'analyzing' ? 'analyzing' : mapResearchPhase(event.phase),
              message: event.message,
              percent: event.percent ?? null,
            })
            emitChanged()
          },
        })
      } else {
        throw new Error(`未知任务类型：${String(job.kind)}`)
      }

      if (signal.aborted) {
        throw Object.assign(new Error('已取消'), { name: 'AbortError' })
      }

      jobs.update(job.id, {
        status: 'succeeded',
        phase: 'ready',
        message: '已完成',
        percent: 100,
        error: null,
        finishedAt: new Date().toISOString(),
      })
      emitChanged([{ id: job.id, status: 'succeeded' }])
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        jobs.update(job.id, {
          status: 'cancelled',
          phase: 'idle',
          message: '已取消',
          error: null,
          finishedAt: new Date().toISOString(),
        })
        emitChanged([{ id: job.id, status: 'cancelled' }])
      } else {
        const message = error instanceof Error ? error.message : '任务失败'
        jobs.update(job.id, {
          status: 'failed',
          phase: 'error',
          message,
          error: message,
          finishedAt: new Date().toISOString(),
        })
        emitChanged([{ id: job.id, status: 'failed' }])
      }
    } finally {
      currentJobId = null
      currentAbort = null
    }
  }

  const pump = async () => {
    if (pumping) return
    pumping = true
    try {
      for (;;) {
        const next = jobs.listQueued()[0]
        if (!next) break
        await runOne(next)
      }
    } finally {
      pumping = false
    }
  }

  return {
    list: () => jobs.list(),

    enqueue: (inputEnqueue) => {
      if (!inputEnqueue.force) {
        const active = jobs.findActiveByDedupeKey(inputEnqueue.dedupeKey)
        if (active) {
          emitChanged()
          return active
        }
      }
      const created = jobs.create(inputEnqueue)
      emitChanged()
      void pump()
      return created
    },

    cancel: (id) => {
      const current = jobs.get(id)
      if (!current) return null
      if (current.status === 'queued') {
        const updated = jobs.update(id, {
          status: 'cancelled',
          phase: 'idle',
          message: '已取消',
          finishedAt: new Date().toISOString(),
        })
        emitChanged()
        return updated
      }
      // 运行中：中断下载 / 转写；状态由 runOne 的 AbortError 分支落库
      if (current.status === 'running' && currentJobId === id) {
        currentAbort?.abort()
        const updated = jobs.update(id, {
          message: '正在取消…',
        })
        emitChanged()
        return updated
      }
      return current
    },

    clearFinished: () => {
      jobs.clearFinished()
      const list = jobs.list()
      emitChanged()
      return list
    },

    resumeQueued: () => {
      jobs.resetRunningToQueued()
      emitChanged()
      void pump()
    },

    patchProgress: (jobId, patch) => {
      const id = jobId || currentJobId
      if (!id) return
      jobs.update(id, {
        phase: patch.phase,
        message: patch.message,
        percent: patch.percent,
      })
      emitChanged()
    },
  }
}
