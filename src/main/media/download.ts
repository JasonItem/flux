import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

import { net } from 'electron'

import { isUsableMediaFile, videoFilePath } from './paths'

const DOUYIN_REFERER = 'https://www.douyin.com/'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const downloadLocks = new Map<string, Promise<{ localPath: string; bytes: number; fromCache: boolean }>>()

export async function downloadVideoToCache(input: {
  awemeId: string
  playUrl: string
  force?: boolean
  onProgress?: (percent: number | undefined) => void
}): Promise<{ localPath: string; bytes: number; fromCache: boolean }> {
  const id = input.awemeId.trim()
  const existing = downloadLocks.get(id)
  if (existing) return existing

  const run = doDownload(input).finally(() => {
    downloadLocks.delete(id)
  })
  downloadLocks.set(id, run)
  return run
}

async function doDownload(input: {
  awemeId: string
  playUrl: string
  force?: boolean
  onProgress?: (percent: number | undefined) => void
}): Promise<{ localPath: string; bytes: number; fromCache: boolean }> {
  const localPath = videoFilePath(input.awemeId)
  if (!input.force && isUsableMediaFile(localPath)) {
    return { localPath, bytes: statSync(localPath).size, fromCache: true }
  }

  // Keep good cache if force download fails later
  const hadGoodCache = isUsableMediaFile(localPath)

  const tempPath = `${localPath}.${randomUUID()}.part`
  try {
    const response = await net.fetch(input.playUrl, {
      method: 'GET',
      headers: {
        Referer: DOUYIN_REFERER,
        Origin: 'https://www.douyin.com',
        'User-Agent': UA,
        Accept: '*/*',
      },
    })

    if (!response.ok || !response.body) {
      throw new Error(`下载视频失败（HTTP ${String(response.status)}）`)
    }

    const totalHeader = response.headers.get('content-length')
    const total = totalHeader ? Number(totalHeader) : 0
    let received = 0

    const nodeStream = Readable.fromWeb(response.body as never)
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (total > 0) input.onProgress?.(Math.min(99, Math.round((received / total) * 100)))
      else input.onProgress?.(undefined)
    })

    await pipeline(nodeStream, createWriteStream(tempPath))

    if (!isUsableMediaFile(tempPath, 16_384)) {
      throw new Error('下载的视频文件过小或损坏')
    }

    try {
      if (existsSync(localPath)) unlinkSync(localPath)
    } catch {
      // ignore
    }
    renameSync(tempPath, localPath)
    input.onProgress?.(100)
    return { localPath, bytes: statSync(localPath).size, fromCache: false }
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath)
    } catch {
      // ignore
    }
    if (hadGoodCache) {
      // Prefer playable cache over a failed re-download
      return { localPath, bytes: statSync(localPath).size, fromCache: true }
    }
    throw error
  }
}
