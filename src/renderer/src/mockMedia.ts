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
  return url
}
