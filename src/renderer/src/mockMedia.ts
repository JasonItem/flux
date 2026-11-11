import bbb from './assets/mock/bbb.mp4'
import flower from './assets/mock/flower.mp4'
import sample5s from './assets/mock/sample5s.mp4'

/** 与 main/research/mockAnalyze 的 app-mock:// 约定对应 */
const MOCK_VIDEOS = [flower, bbb, sample5s] as const

export function isAppMockMediaUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith('app-mock://'))
}

export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const videoMatch = /^app-mock:\/\/video\/(\d+)$/.exec(url)
  if (videoMatch) {
    const index = Number(videoMatch[1]) % MOCK_VIDEOS.length
    return MOCK_VIDEOS[index] ?? null
  }
  // 本地缓存：loopback HTTP 或 flux-media 自定义协议
  if (
    url.startsWith('flux-media://') ||
    url.startsWith('http://127.0.0.1:') ||
    url.startsWith('http://localhost:')
  ) {
    return url
  }
  return url
}
