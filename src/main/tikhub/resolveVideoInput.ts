const URL_RE = /https?:\/\/[^\s<>"']+/i
const AWEME_PATH_RE =
  /(?:douyin\.com|iesdouyin\.com)\/(?:share\/)?(?:video|note)\/(\d{6,30})/i
const AWEME_QUERY_RE = /(?:[?&#](?:modal_id|aweme_id|awemeId|item_ids)=)(\d{6,30})/i
const AWEME_PLAIN_RE = /^\d{15,25}$/

export interface ParsedDouyinVideoInput {
  awemeId: string | null
  shareUrl: string | null
  sourceInput: string
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[),.;!?，。；！？]+$/g, '')
}

function extractAwemeIdFromText(text: string): string | null {
  const pathMatch = text.match(AWEME_PATH_RE)
  if (pathMatch?.[1]) return pathMatch[1]
  const queryMatch = text.match(AWEME_QUERY_RE)
  if (queryMatch?.[1]) return queryMatch[1]
  const plain = text.trim()
  if (AWEME_PLAIN_RE.test(plain)) return plain
  return null
}

export function parseDouyinVideoInput(raw: string): ParsedDouyinVideoInput {
  const sourceInput = raw.trim()
  if (!sourceInput) throw new Error('请粘贴抖音视频链接或分享口令')

  const lowered = sourceInput.toLowerCase()
  if (lowered.includes('tiktok.com') || lowered.includes('vm.tiktok.com')) {
    throw new Error('本软件仅支持国内抖音，不支持海外 TikTok 链接')
  }

  const directId = extractAwemeIdFromText(sourceInput)
  if (directId) {
    return { awemeId: directId, shareUrl: null, sourceInput }
  }

  const matchedUrl = sourceInput.match(URL_RE)?.[0]
  if (!matchedUrl) {
    throw new Error('未识别到视频链接，请粘贴含 v.douyin.com 或 douyin.com/video/ 的地址')
  }

  const url = stripTrailingPunctuation(matchedUrl)
  if (
    !/douyin\.com/i.test(url) &&
    !/iesdouyin\.com/i.test(url) &&
    !/v\.douyin\.com/i.test(url)
  ) {
    throw new Error('仅支持抖音视频链接（douyin.com / v.douyin.com）')
  }

  const fromUrl = extractAwemeIdFromText(url)
  if (fromUrl) {
    return { awemeId: fromUrl, shareUrl: url, sourceInput }
  }

  return { awemeId: null, shareUrl: url, sourceInput }
}

/** 短链跳转到最终页，再从落地 URL 提取 aweme_id */
export async function resolveDouyinAwemeId(raw: string): Promise<string> {
  const parsed = parseDouyinVideoInput(raw)
  if (parsed.awemeId) return parsed.awemeId
  if (!parsed.shareUrl) throw new Error('无法解析视频 ID')

  let finalUrl = parsed.shareUrl
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12_000)
    try {
      const response = await fetch(parsed.shareUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        },
      })
      if (response.url) finalUrl = response.url
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // 短链展开失败时仍用原链接再试一次正则
  }

  const resolved = extractAwemeIdFromText(finalUrl)
  if (!resolved) {
    throw new Error('未能从链接提取视频 ID，请改用含 /video/数字 的完整链接')
  }
  return resolved
}