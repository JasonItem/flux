import { BrowserWindow } from 'electron'

import type { MediaEnsureResult, MediaProgressEvent } from '../../shared/media'
import type { TikHubService } from '../tikhub/service'
import type { ResearchRepository } from '../research/repository'
import { downloadVideoToCache } from './download'
import { localMediaPlayUrl } from './localServer'
import { isUsableMediaFile, mediaRootDir, videoFilePath } from './paths'
import { transcribeLocalVideo, type TranscriptResult } from './asr'

export type MediaProgressListener = (event: MediaProgressEvent) => void

export interface MediaService {
  ensureByAwemeId: (
    awemeId: string,
    options?: { playUrl?: string | null; force?: boolean },
  ) => Promise<MediaEnsureResult>
  ensureResearchVideo: (
    id: string,
    options?: { force?: boolean },
  ) => Promise<MediaEnsureResult>
  getLocalPlayUrl: (awemeId: string) => string | null
  transcribeAweme: (
    awemeId: string,
    options?: {
      researchVideoId?: string
      onProgress?: (message: string, percent?: number) => void
      signal?: AbortSignal
    },
  ) => Promise<TranscriptResult>
  mediaRootDir: () => string
}

function broadcastProgress(event: MediaProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('media:progress', event)
  }
}

export function createMediaService(input: {
  tikhub: TikHubService
  research: ResearchRepository
}): MediaService {
  const { tikhub, research } = input

  const emit = (
    awemeId: string,
    phase: MediaProgressEvent['phase'],
    message: string,
    extra?: { researchVideoId?: string; percent?: number },
  ) => {
    broadcastProgress({
      awemeId,
      phase,
      message,
      researchVideoId: extra?.researchVideoId,
      percent: extra?.percent,
    })
  }

  const ensureByAwemeId: MediaService['ensureByAwemeId'] = async (awemeId, options = {}) => {
    const id = awemeId.trim()
    if (!id) throw new Error('缺少 awemeId')

    const localPath = videoFilePath(id)
    if (!options.force && isUsableMediaFile(localPath)) {
      const { statSync } = await import('node:fs')
      return {
        awemeId: id,
        localPath,
        playUrl: localMediaPlayUrl(id),
        bytes: statSync(localPath).size,
        fromCache: true,
      }
    }

    let playUrl = options.playUrl?.trim() || ''
    emit(id, 'refreshing', '正在刷新视频直链…')
    try {
      const one = await tikhub.fetchOneVideo(id)
      if (one?.playUrl) playUrl = one.playUrl
    } catch {
      // keep provided playUrl
    }
    if (!playUrl) throw new Error('无法获取可下载的视频直链')

    emit(id, 'downloading', '正在下载视频到本地…', { percent: 0 })
    const downloaded = await downloadVideoToCache({
      awemeId: id,
      playUrl,
      force: Boolean(options.force),
      onProgress: (percent) =>
        emit(id, 'downloading', '正在下载视频到本地…', { percent }),
    })
    emit(id, 'ready', downloaded.fromCache ? '已使用本地缓存' : '视频已下载', {
      percent: 100,
    })
    return {
      awemeId: id,
      localPath: downloaded.localPath,
      playUrl: localMediaPlayUrl(id),
      bytes: downloaded.bytes,
      fromCache: downloaded.fromCache,
    }
  }

  return {
    ensureByAwemeId,

    ensureResearchVideo: async (researchId, options = {}) => {
      const source = research.getVideoSource(researchId)
      const awemeId = source.awemeId?.trim()
      if (!awemeId) throw new Error('该样本没有抖音 aweme_id，无法下载')

      const result = await ensureByAwemeId(awemeId, {
        playUrl: source.detail.playUrl,
        force: options.force,
      })

      research.updateVideoMedia(researchId, {
        playUrl: result.playUrl,
        localPath: result.localPath,
        mediaStatus: 'ready',
      })
      return result
    },

    getLocalPlayUrl: (awemeId) => {
      const id = awemeId.trim()
      if (!id || !isUsableMediaFile(videoFilePath(id))) return null
      return localMediaPlayUrl(id)
    },

    transcribeAweme: async (awemeId, options = {}) => {
      const id = awemeId.trim()
      const ensured = await ensureByAwemeId(id)
      emit(id, 'transcribing', '正在转写原视频文案…', {
        researchVideoId: options.researchVideoId,
        percent: 10,
      })
      options.onProgress?.('正在转写原视频文案…', 10)
      const result = await transcribeLocalVideo({
        awemeId: id,
        videoPath: ensured.localPath,
        signal: options.signal,
        onProgress: (message, percent) => {
          const phase =
            message.includes('Whisper') || message.includes('模型') || message.includes('引擎')
              ? ('extracting' as const)
              : ('transcribing' as const)
          emit(id, phase, message, {
            researchVideoId: options.researchVideoId,
            percent,
          })
          options.onProgress?.(message, percent)
        },
      })
      return result
    },

    mediaRootDir,
  }
}
