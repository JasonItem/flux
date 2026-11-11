const URL_RE = /https?:\/\/[^\s<>"']+/i
const SEC_USER_RE = /douyin\.com\/user\/([A-Za-z0-9_\-]+)/i

export type DouyinInputKind = 'profile_url' | 'share_url' | 'unique_id'

export interface ParsedDouyinInput {
  kind: DouyinInputKind
  value: string
  sourceInput: string
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[),.;!?，。；！？]+$/g, '')
}

export function parseDouyinAccountInput(raw: string): ParsedDouyinInput {
  const sourceInput = raw.trim()
  if (!sourceInput) throw new Error('请输入抖音主页链接、分享链接或抖音号')

  const lowered = sourceInput.toLowerCase()
  if (lowered.includes('tiktok.com') || lowered.includes('vm.tiktok.com')) {
    throw new Error('本软件仅支持国内抖音，不支持海外 TikTok 链接')
  }

  const matchedUrl = sourceInput.match(URL_RE)?.[0]
  if (matchedUrl) {
    const url = stripTrailingPunctuation(matchedUrl)
    const secMatch = url.match(SEC_USER_RE)
    if (secMatch?.[1]) {
      return {
        kind: 'profile_url',
        value: secMatch[1],
        sourceInput,
      }
    }
    if (
      /douyin\.com/i.test(url) ||
      /iesdouyin\.com/i.test(url) ||
      /v\.douyin\.com/i.test(url)
    ) {
      return { kind: 'share_url', value: url, sourceInput }
    }
    throw new Error('仅支持抖音主页链接或分享链接（douyin.com）')
  }

  // Plain Douyin ID / unique_id
  if (/^[\w.\-一-龥]{2,64}$/u.test(sourceInput) && !sourceInput.includes('://')) {
    return { kind: 'unique_id', value: sourceInput.replace(/^@/, ''), sourceInput }
  }

  throw new Error('无法识别输入，请粘贴抖音主页链接、分享口令中的链接，或填写抖音号')
}
