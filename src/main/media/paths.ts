import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'

let mediaHttpPort = 0

export function setMediaHttpPort(port: number): void {
  mediaHttpPort = port
}

export function getMediaHttpPort(): number {
  return mediaHttpPort
}

/** Prefer loopback HTTP for <video>; falls back to flux-media custom scheme. */
export function localPlayUrlForAweme(awemeId: string): string | null {
  const id = awemeId.trim()
  if (!id || !isUsableMediaFile(videoFilePath(id))) return null
  if (mediaHttpPort > 0) {
    return `http://127.0.0.1:${String(mediaHttpPort)}/v/${encodeURIComponent(id)}.mp4`
  }
  return `flux-media://${encodeURIComponent(id)}`
}

export function mediaRootDir(): string {
  const dir = join(app.getPath('userData'), 'media')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function whisperRootDir(): string {
  const dir = join(app.getPath('userData'), 'models', 'whisper')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function videoFilePath(awemeId: string): string {
  const safe = awemeId.replace(/[^\w.-]+/g, '_')
  return join(mediaRootDir(), `${safe}.mp4`)
}

export function audioFilePath(awemeId: string): string {
  const safe = awemeId.replace(/[^\w.-]+/g, '_')
  return join(mediaRootDir(), `${safe}.wav`)
}

export function isUsableMediaFile(path: string, minBytes = 32_768): boolean {
  if (!existsSync(path)) return false
  try {
    return statSync(path).size >= minBytes
  } catch {
    return false
  }
}
