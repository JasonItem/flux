import { BrowserWindow } from 'electron'

import {
  workshopReplicateJobDedupeKey,
  type StudioJob,
} from '../../shared/jobs'
import type {
  WorkshopProgressEvent,
  WorkshopScriptDetail,
  WorkshopScriptSummary,
  WorkshopScriptUpdateInput,
} from '../../shared/workshop'
import { workshopScriptHref } from '../../shared/workshop'
import type { JobService } from '../jobs/service'
import type { LlmService } from '../llm/service'
import type { ResearchRepository } from '../research/repository'
import { replicateScriptWithLlm } from './replicateAnalyze'
import type { WorkshopRepository } from './repository'

export interface WorkshopService {
  listScripts: () => WorkshopScriptSummary[]
  getScript: (id: string) => WorkshopScriptDetail
  updateScript: (input: WorkshopScriptUpdateInput) => WorkshopScriptDetail
  deleteScript: (id: string) => void
  enqueueReplicate: (researchVideoId: string, options?: { force?: boolean }) => StudioJob
  runReplicate: (
    researchVideoId: string,
    scriptId?: string,
    hooks?: { onProgress?: (event: WorkshopProgressEvent) => void },
  ) => Promise<WorkshopScriptDetail>
}

function emitProgress(event: WorkshopProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('workshop:progress', event)
  }
}

export function createWorkshopService(input: {
  workshop: WorkshopRepository
  research: ResearchRepository
  llm: LlmService
  jobs: JobService
}): WorkshopService {
  const { workshop, research, llm, jobs } = input

  return {
    listScripts: () => workshop.listScripts(),
    getScript: (id) => workshop.getScript(id),
    updateScript: (payload) => workshop.updateScript(payload),
    deleteScript: (id) => workshop.deleteScript(id),

    enqueueReplicate: (researchVideoId, options = {}) => {
      const detail = research.getVideo(researchVideoId)
      if (!detail.fullTranscript?.trim()) {
        throw new Error('请先完成样本拆解（需要原片转写与结构）再复刻')
      }
      const existing = workshop.findLatestBySource(researchVideoId)
      const script =
        existing && existing.status !== 'ready' && !options.force
          ? existing
          : workshop.createScript({
              title: `复刻｜${detail.title.slice(0, 28)}`,
              status: 'generating',
              sourceResearchVideoId: detail.id,
              sourceAwemeId: detail.awemeId,
              sourceTitle: detail.title,
              topicId: detail.topicId,
              topicTitle: detail.topicTitle,
              videoType: detail.videoType,
              angle: '生成中…',
              summary: '正在按样本结构仿写口播脚本…',
              durationHintSec: detail.durationSec,
            })

      if (script.status !== 'generating') {
        workshop.updateStatus(script.id, { status: 'generating', error: null })
      }

      return jobs.enqueue({
        kind: 'workshop.replicate',
        title: `复刻脚本：${detail.title.slice(0, 28)}`,
        href: workshopScriptHref(script.id),
        dedupeKey: workshopReplicateJobDedupeKey(researchVideoId),
        payload: { researchVideoId, scriptId: script.id },
        force: Boolean(options.force),
      })
    },

    runReplicate: async (researchVideoId, scriptId, hooks) => {
      const detail = research.getVideo(researchVideoId)
      if (!detail.fullTranscript?.trim()) {
        throw new Error('样本尚未拆解完成，无法复刻')
      }

      let script = scriptId
        ? workshop.getScript(scriptId)
        : workshop.findLatestBySource(researchVideoId) ||
          workshop.createScript({
            title: `复刻｜${detail.title.slice(0, 28)}`,
            status: 'generating',
            sourceResearchVideoId: detail.id,
            sourceAwemeId: detail.awemeId,
            sourceTitle: detail.title,
            topicId: detail.topicId,
            topicTitle: detail.topicTitle,
            videoType: detail.videoType,
            durationHintSec: detail.durationSec,
          })

      const progress = (
        phase: WorkshopProgressEvent['phase'],
        message: string,
        percent?: number,
      ) => {
        const event = {
          scriptId: script.id,
          researchVideoId,
          phase,
          message,
          percent,
        }
        emitProgress(event)
        hooks?.onProgress?.(event)
      }

      try {
        workshop.updateStatus(script.id, { status: 'generating', error: null })
        progress('analyzing', '正在用大模型按样本思路仿写口播…', 30)
        const result = await replicateScriptWithLlm(llm, detail)
        progress('analyzing', '正在写入创作工坊…', 85)
        script = workshop.updateStatus(script.id, {
          status: 'ready',
          error: null,
          title: result.draft.title,
          angle: result.draft.angle,
          summary:
            result.source === 'fallback' && result.note
              ? `${result.draft.summary}（规则兜底：${result.note}）`
              : result.draft.summary,
          durationHintSec: result.draft.durationHintSec,
          segments: result.draft.segments,
          hooks: result.draft.hooks,
          ctaOptions: result.draft.ctaOptions,
          commentInsights: result.draft.commentInsights,
        })
        progress('ready', '复刻完成', 100)
        return script
      } catch (error) {
        const message = error instanceof Error ? error.message : '复刻失败'
        script = workshop.updateStatus(script.id, {
          status: 'error',
          error: message,
        })
        progress('error', message)
        throw error
      }
    },
  }
}