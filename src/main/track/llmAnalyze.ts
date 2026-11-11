import type { DouyinAccount, DouyinVideoItem } from '../../shared/tikhub'
import type { TrackCompositionItem, TrackDiagnosis, TrackInfluencer } from '../../shared/track'
import { asNumber, asRecord, asStringArray, clampScore, extractJsonValue } from '../llm/json'
import type { LlmService } from '../llm/service'
import type { TrackCandidateInsert } from './repository'
import { buildMockTrackResult } from './mockAnalyze'

function parseInfluencers(raw: unknown): TrackInfluencer[] {
  // 红人交给后续 TikHub 搜索填充，这里不造假数据
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, 3)
    .map((item) => {
      const row = asRecord(item) ?? {}
      const nickname = String(row.nickname ?? '').trim()
      if (!nickname) return null
      const followerCount = asNumber(row.followerCount, 0)
      const awemeCount = asNumber(row.awemeCount, 0)
      if (followerCount <= 0 && awemeCount <= 0 && !row.uniqueId && !row.avatarUrl) return null
      const uniqueId =
        typeof row.uniqueId === 'string' && row.uniqueId.trim() ? row.uniqueId.trim() : null
      return {
        nickname,
        uniqueId,
        avatarUrl: typeof row.avatarUrl === 'string' ? row.avatarUrl : null,
        signature: typeof row.signature === 'string' ? row.signature : null,
        followerCount,
        awemeCount,
        highlight: String(row.highlight ?? row.signature ?? '').trim(),
        profileUrl:
          typeof row.profileUrl === 'string' && row.profileUrl
            ? row.profileUrl
            : uniqueId
              ? `https://www.douyin.com/search/${encodeURIComponent(uniqueId)}`
              : `https://www.douyin.com/search/${encodeURIComponent(nickname)}`,
      }
    })
    .filter((item): item is TrackInfluencer => Boolean(item))
}

function normalizeSearchHint(raw: unknown, trackName: string): string | null {
  const hint = String(raw ?? '')
    .replace(/\s+/g, '')
    .trim()
  if (hint.length >= 2 && hint.length <= 12) return hint
  const fallback = trackName
    .replace(/干货|实操|复盘|测评|指南|观察|拆解|纪实|教程|攻略/g, '')
    .trim()
  if (fallback.length >= 2 && fallback.length <= 12) return fallback
  return trackName.slice(0, 8) || null
}

function parseTrackPayload(raw: unknown): {
  diagnosis: TrackDiagnosis
  candidates: TrackCandidateInsert[]
} {
  const root = asRecord(raw)
  if (!root) throw new Error('赛道分析结果格式无效')
  const diagnosisRaw = asRecord(root.diagnosis) ?? root
  const compositionRaw = Array.isArray(diagnosisRaw.composition) ? diagnosisRaw.composition : []
  const composition = compositionRaw
    .map((item) => {
      const row = asRecord(item)
      if (!row) return null
      const label = String(row.label ?? '').trim()
      if (!label) return null
      return {
        label,
        share: clampScore(asNumber(row.share, 20)),
        signal: String(row.signal ?? label).trim(),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 6)

  const diagnosis: TrackDiagnosis = {
    positioning: String(diagnosisRaw.positioning ?? '').trim() || '暂无定位摘要',
    composition:
      composition.length > 0
        ? composition
        : [{ label: '信号不足', share: 100, signal: '模型未返回成分分布' }],
    strengths: asStringArray(diagnosisRaw.strengths, ['账号有可识别方向，可继续收窄赛道。']).slice(
      0,
      4,
    ),
    weaknesses: asStringArray(diagnosisRaw.weaknesses, [
      '仍需用更具体的人群与场景压实定位。',
    ]).slice(0, 4),
  }

  const candidatesRaw = Array.isArray(root.candidates) ? root.candidates : []
  const candidates = candidatesRaw
    .map((item, index): TrackCandidateInsert | null => {
      const row = asRecord(item)
      if (!row) return null
      const name = String(row.name ?? '').trim()
      if (!name) return null
      return {
        name,
        summary: String(row.summary ?? `围绕「${name}」建立稳定人设与选题节奏。`).trim(),
        heatScore: clampScore(asNumber(row.heatScore, 70 - index * 3)),
        competitionScore: clampScore(asNumber(row.competitionScore, 45 + index * 5)),
        potentialScore: clampScore(asNumber(row.potentialScore, 78 - index * 4)),
        metrics: null,
        reason: String(row.reason ?? `基于账号内容成分推荐赛道「${name}」。`).trim(),
        evidence: asStringArray(row.evidence, [`来自账号近作与简介的「${name}」信号`]).slice(0, 5),
        influencers: parseInfluencers(row.influencers),
        sortOrder: index,
        searchHint: normalizeSearchHint(row.searchHint, name),
      }
    })
    .filter((item): item is TrackCandidateInsert => Boolean(item))
    .slice(0, 8)

  if (candidates.length === 0) throw new Error('模型未返回可用赛道候选')
  return { diagnosis, candidates }
}

function buildTrackUserPayload(
  account: DouyinAccount,
  videos: DouyinVideoItem[],
  compositionHint?: TrackCompositionItem[],
): string {
  const videoLines = videos.slice(0, 18).map((item, index) => ({
    i: index + 1,
    desc: item.description.slice(0, 80),
    digg: item.diggCount,
    comment: item.commentCount,
    share: item.shareCount,
    play: item.playCount,
    durationSec: item.durationMs ? Math.round(item.durationMs / 1000) : null,
  }))

  return JSON.stringify(
    {
      account: {
        nickname: account.nickname,
        uniqueId: account.uniqueId,
        signature: account.signature,
        followerCount: account.followerCount,
        awemeCount: account.awemeCount,
      },
      localCompositionHint: compositionHint ?? [],
      recentVideos: videoLines,
    },
    null,
    2,
  )
}

export async function analyzeTrackWithLlm(
  llm: LlmService,
  account: DouyinAccount,
  videos: DouyinVideoItem[],
  options?: { compositionHint?: TrackCompositionItem[] },
): Promise<{
  diagnosis: TrackDiagnosis
  candidates: TrackCandidateInsert[]
  source: 'llm' | 'fallback'
  note?: string
}> {
  try {
    const result = await llm.chat({
      temperature: 0.45,
      maxTokens: 4200,
      messages: [
        {
          role: 'system',
          content: `你是抖音账号赛道策略顾问。根据账号资料、近作，以及本地预估的内容成分 hint，先校准成分，再推荐可运营赛道。
数量：必须输出 6～8 条 candidates（可以是 6、7 或 8，禁止刚好固定只给 5 条）。
命名与多样性要求：
- 标题落在「领域 + 内容方向」，例如「跨境电商产业观察」「外贸创业实战」「工厂出海转型」「AI外贸工具」；
- 比「某市某镇某品类/园区巡礼」更宽，但不要只给「知识干货」「实操复盘」这类无领域大类；
- 条目须覆盖不同轴：产业观察、创业实战、人物故事、工具方法、获客转化等，避免彼此只改两三个字；
- 禁止半数以上标题以「干货」结尾；
- 每条必须给 searchHint：2～6 个汉字的抖音可搜短词（如「工厂出海」「跨境电商」），不要整段长标题。
只输出 JSON，不要 markdown，不要解释。结构：
{
  "diagnosis": {
    "positioning": "一句话定位",
    "composition": [{"label":"成分名","share":0-100,"signal":"依据词"}],
    "strengths": ["..."],
    "weaknesses": ["..."]
  },
  "candidates": [{
    "name":"赛道名",
    "searchHint":"短检索词",
    "summary":"一句话说明",
    "heatScore":1-100,
    "competitionScore":1-100,
    "potentialScore":1-100,
    "reason":"推荐理由",
    "evidence":["数据/文本依据"],
    "influencers":[]
  }]
}
注意：influencers 请返回空数组，红人由系统用抖音搜索接口补齐，不要编造粉丝数。`,
        },
        {
          role: 'user',
          content: `请分析以下抖音账号并给出更广、可检索的赛道推荐。localCompositionHint 仅作参考，可修正：\n${buildTrackUserPayload(account, videos, options?.compositionHint)}`,
        },
      ],
    })

    const parsed = parseTrackPayload(extractJsonValue(result.content))
    return { ...parsed, source: 'llm' }
  } catch (error) {
    const fallback = buildMockTrackResult(account, videos)
    const message = error instanceof Error ? error.message : '大模型分析失败'
    return {
      ...fallback,
      source: 'fallback',
      note: message,
    }
  }
}
