export const MediaChannels = {
  ensureByAwemeId: 'media:ensureByAwemeId',
  ensureResearchVideo: 'media:ensureResearchVideo',
  getLocalPlayUrl: 'media:getLocalPlayUrl',
  progress: 'media:progress',
} as const

export type MediaPhase =
  | 'idle'
  | 'refreshing'
  | 'downloading'
  | 'ready'
  | 'extracting'
  | 'transcribing'
  | 'analyzing'
  | 'error'

export interface MediaProgressEvent {
  awemeId: string
  researchVideoId?: string
  phase: MediaPhase
  message: string
  /** 0-100 when known */
  percent?: number
}

export interface MediaEnsureResult {
  awemeId: string
  localPath: string
  playUrl: string
  bytes: number
  fromCache: boolean
}

export interface MediaApi {
  ensureByAwemeId: (
    awemeId: string,
    options?: { playUrl?: string | null; force?: boolean },
  ) => Promise<MediaEnsureResult>
  ensureResearchVideo: (
    id: string,
    options?: { force?: boolean },
  ) => Promise<MediaEnsureResult>
  getLocalPlayUrl: (awemeId: string) => Promise<string | null>
  onProgress: (callback: (event: MediaProgressEvent) => void) => () => void
}

export function fluxMediaUrl(awemeId: string): string {
  const id = awemeId.trim()
  return `flux-media://${encodeURIComponent(id)}`
}

export function parseFluxMediaAwemeId(url: string): string | null {
  if (!url.startsWith('flux-media://')) return null
  try {
    const parsed = new URL(url)
    const host = parsed.hostname?.trim() || ''
    const path = parsed.pathname.replace(/^\/+/, '').trim()
    const raw = host || path || url.slice('flux-media://'.length).split(/[?#]/)[0] || ''
    const id = decodeURIComponent(raw).replace(/\/+$/, '').trim()
    return id || null
  } catch {
    try {
      const rest = url.slice('flux-media://'.length).split(/[?#]/)[0] ?? ''
      return decodeURIComponent(rest).replace(/\/+$/, '').trim() || null
    } catch {
      return null
    }
  }
}
