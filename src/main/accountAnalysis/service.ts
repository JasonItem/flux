import type {
  AccountAnalysisDetail,
  AccountAnalysisVideoRow,
  AccountVideoAnalysis,
  AccountVideoComment,
} from '../../shared/accountAnalysis'
import type { DouyinAccount, DouyinVideoItem } from '../../shared/tikhub'
import type { LlmService } from '../llm/service'
import type { DouyinCommentItem } from '../tikhub/client'
import type { TikHubService } from '../tikhub/service'
import type { TrackRepository } from '../track/repository'
import { analyzeAccountInsightsWithLlm, analyzeVideoWithLlm } from './llmAnalyze'
import { buildMetrics, buildVideoRows } from './metrics'
import {
  buildRuleAccountDiagnosis,
  buildRuleCollections,
  buildRulePortraitBundle,
  buildRuleTopicPlans,
  buildRuleVideoAnalysis,
} from './mockAnalyze'
import type { AccountAnalysisRepository } from './repository'

export interface AccountAnalysisService {
  getAnalysis: (accountId: string) => AccountAnalysisDetail | null
  analyzeAccount: (accountId: string) => Promise<AccountAnalysisDetail>
  getVideoAnalysis: (accountId: string, awemeId: string) => Promise<AccountVideoAnalysis>
  refreshVideoAnalysis: (accountId: string, awemeId: string) => Promise<AccountVideoAnalysis>
}

const TARGET_VIDEO_COUNT = 36

function resolveAccount(tikhub: TikHubService, accountId: string): DouyinAccount {
  const accounts = tikhub.listAccounts()
  if (accounts.length === 0) {
    throw new Error('请先在「账号管理」绑定至少一个抖音账号')
  }
  const matched = accounts.find((item) => item.id === accountId)
  if (!matched) throw new Error('指定账号不存在')
  return matched
}

async function fetchAccountVideos(
  tikhub: TikHubService,
  accountId: string,
): Promise<DouyinVideoItem[]> {
  const collected: DouyinVideoItem[] = []
  let cursor = '0'
  let guard = 0
  while (collected.length < TARGET_VIDEO_COUNT && guard < 4) {
    guard += 1
    const page = await tikhub.listAccountVideos(accountId, {
      maxCursor: cursor,
      count: 18,
    })
    collected.push(...page.items)
    if (!page.hasMore || !page.maxCursor || page.maxCursor === cursor) break
    cursor = page.maxCursor
  }
  const seen = new Set<string>()
  return collected
    .filter((item) => {
      if (!item.awemeId || seen.has(item.awemeId)) return false
      seen.add(item.awemeId)
      return true
    })
    .slice(0, TARGET_VIDEO_COUNT)
}

/** 缺封面时按 aweme 补拉详情（控并发） */
async function enrichMissingCovers(
  tikhub: TikHubService,
  videos: DouyinVideoItem[],
): Promise<DouyinVideoItem[]> {
  const missing = videos.filter((item) => !item.coverUrl && item.awemeId)
  if (missing.length === 0) return videos

  const enriched = new Map<string, DouyinVideoItem>()
  const queue = 4
  for (let i = 0; i < missing.length; i += queue) {
    const batch = missing.slice(i, i + queue)
    await Promise.all(
      batch.map(async (item) => {
        try {
          const one = await tikhub.fetchOneVideo(item.awemeId)
          if (!one) return
          enriched.set(item.awemeId, {
            ...item,
            coverUrl: one.coverUrl || item.coverUrl,
            playUrl: one.playUrl || item.playUrl,
            durationMs: one.durationMs || item.durationMs,
            diggCount: one.diggCount || item.diggCount,
            commentCount: one.commentCount || item.commentCount,
            shareCount: one.shareCount || item.shareCount,
            playCount: one.playCount || item.playCount,
          })
        } catch {
          // 单条失败跳过
        }
      }),
    )
  }

  return videos.map((item) => enriched.get(item.awemeId) ?? item)
}

function resolveTrackName(track: TrackRepository, accountId: string): string | null {
  const summaries = track.listSummaries(accountId)
  const latestReady = summaries.find((item) => item.status === 'ready')
  if (!latestReady) return null
  try {
    const assessment = track.getAssessment(latestReady.id)
    const top = assessment.candidates[0]
    return top?.name?.trim() || assessment.diagnosis?.positioning || null
  } catch {
    return null
  }
}

function pickCommentSampleTargets(videos: AccountAnalysisVideoRow[]): AccountAnalysisVideoRow[] {
  const high = videos.filter((item) => item.performanceTag === 'high').slice(0, 3)
  const low = videos.filter((item) => item.performanceTag === 'low').slice(0, 3)
  const mid = videos.filter((item) => item.performanceTag === 'mid').slice(0, 1)
  const map = new Map<string, AccountAnalysisVideoRow>()
  for (const item of [...high, ...low, ...mid]) map.set(item.awemeId, item)
  return [...map.values()].slice(0, 6)
}

async function collectCommentSnippets(
  tikhub: TikHubService,
  targets: AccountAnalysisVideoRow[],
): Promise<string[]> {
  const snippets: string[] = []
  for (const target of targets) {
    try {
      const comments = await tikhub.listVideoComments(target.awemeId, 12)
      for (const comment of comments.slice(0, 8)) {
        const text = comment.content.trim()
        if (text) snippets.push(text.slice(0, 80))
      }
    } catch {
      // 单条评论失败跳过
    }
  }
  return snippets.slice(0, 40)
}

function requireVideoRow(
  detail: AccountAnalysisDetail,
  awemeId: string,
): AccountAnalysisVideoRow {
  const row = detail.videos.find((item) => item.awemeId === awemeId)
  if (!row) throw new Error('作品不在当前账号分析样本中，请先重新分析账号')
  return row
}

function mapVideoComments(
  list: DouyinCommentItem[],
  prefix = 'c',
): AccountVideoComment[] {
  return list.map((item, index) => {
    const id = item.cid || `${prefix}-${String(index)}`
    const replies = mapVideoComments(item.replies ?? [], id)
    const replyCount = Math.max(item.replyCount, replies.length)
    const replyRate =
      item.diggCount > 0 ? Number((replyCount / item.diggCount).toFixed(3)) : 0
    return {
      id,
      author: item.author,
      avatarUrl: item.avatarUrl,
      content: item.content,
      diggCount: item.diggCount,
      replyCount,
      replyRate,
      qualityScore: Math.min(99, Math.round(item.diggCount * 0.05 + replyCount * 1.8)),
      replies,
    }
  })
}

async function buildVideoAnalysis(
  tikhub: TikHubService,
  llm: LlmService,
  detail: AccountAnalysisDetail,
  awemeId: string,
  force: boolean,
): Promise<AccountVideoAnalysis> {
  if (!force) {
    const cached = detail.videoAnalyses[awemeId]
    // 有完整评论缓存则直接返回；旧缓存缺评论时补拉评论区
    if (cached && Array.isArray(cached.comments) && cached.comments.length > 0) {
      return cached
    }
    if (cached) {
      try {
        const raw = await tikhub.listVideoComments(awemeId, 20)
        const comments = mapVideoComments(raw)
        const next = {
          ...cached,
          comments,
          sampleCommentCount: comments.length || cached.sampleCommentCount,
        }
        return next
      } catch {
        return { ...cached, comments: cached.comments ?? [] }
      }
    }
  }

  let video = requireVideoRow(detail, awemeId)
  try {
    const one = await tikhub.fetchOneVideo(awemeId)
    if (one) {
      video = {
        ...video,
        coverUrl: one.coverUrl || video.coverUrl,
        playUrl: one.playUrl || video.playUrl,
        diggCount: one.diggCount || video.diggCount,
        commentCount: one.commentCount || video.commentCount,
        shareCount: one.shareCount || video.shareCount,
        playCount: one.playCount || video.playCount,
        durationSec: one.durationMs
          ? Math.max(1, Math.round(one.durationMs / 1000))
          : video.durationSec,
      }
    }
  } catch {
    // 媒体补齐失败不阻断
  }

  let commentSnippets: string[] = []
  let comments: AccountVideoComment[] = []
  try {
    const raw = await tikhub.listVideoComments(awemeId, 20)
    comments = mapVideoComments(raw)
    commentSnippets = comments.map((item) => item.content.trim()).filter(Boolean).slice(0, 25)
  } catch {
    comments = []
    commentSnippets = []
  }

  try {
    return await analyzeVideoWithLlm(llm, {
      video,
      commentSnippets,
      comments,
      accountPortrait: detail.portrait,
    })
  } catch {
    return buildRuleVideoAnalysis({
      video,
      commentSnippets,
      comments,
      accountPortrait: detail.portrait,
    })
  }
}

export function createAccountAnalysisService(
  repo: AccountAnalysisRepository,
  tikhub: TikHubService,
  track: TrackRepository,
  llm: LlmService,
): AccountAnalysisService {
  return {
    getAnalysis: (accountId) => {
      resolveAccount(tikhub, accountId)
      return repo.getReadyByAccountId(accountId)
    },

    analyzeAccount: async (accountId) => {
      resolveAccount(tikhub, accountId)

      try {
        try {
          await tikhub.refreshAccount(accountId)
        } catch {
          // ignore
        }

        const fresh = resolveAccount(tikhub, accountId)
        const rawVideos = await enrichMissingCovers(
          tikhub,
          await fetchAccountVideos(tikhub, accountId),
        )
        let videos = buildVideoRows(rawVideos)
        const metrics = buildMetrics(videos)
        const trackName = resolveTrackName(track, accountId)
        const commentTargets = pickCommentSampleTargets(videos)
        const commentSnippets = await collectCommentSnippets(tikhub, commentTargets)

        const ruleCollections = buildRuleCollections(videos)
        const rulePortrait = buildRulePortraitBundle({
          account: fresh,
          videos,
          commentSnippets,
          trackName,
        })
        let pack: {
          diagnosis: ReturnType<typeof buildRuleAccountDiagnosis>
          portrait: ReturnType<typeof buildRulePortraitBundle>
          collections: typeof ruleCollections.collections
          videos: AccountAnalysisVideoRow[]
          topicPlans: ReturnType<typeof buildRuleTopicPlans>
          source: 'llm' | 'fallback'
        } = {
          diagnosis: buildRuleAccountDiagnosis({
            account: fresh,
            metrics,
            videos,
            trackName,
          }),
          portrait: rulePortrait,
          collections: ruleCollections.collections,
          videos: ruleCollections.videos,
          topicPlans: buildRuleTopicPlans({
            account: fresh,
            videos: ruleCollections.videos,
            trackName,
            portrait: rulePortrait,
          }),
          source: 'fallback',
        }

        try {
          const llmPack = await analyzeAccountInsightsWithLlm(llm, {
            account: fresh,
            metrics,
            videos,
            trackName,
            commentSnippets,
          })
          pack = {
            diagnosis: llmPack.diagnosis,
            portrait: llmPack.portrait,
            collections: llmPack.collections,
            videos: llmPack.videos,
            topicPlans: llmPack.topicPlans,
            source: llmPack.source,
          }
          videos = llmPack.videos
        } catch {
          videos = pack.videos
        }

        // 不传 videoAnalyses：保留已拆解过的单视频缓存
        return repo.upsert({
          accountId,
          status: 'ready',
          diagnosis: pack.diagnosis,
          portrait: pack.portrait,
          collections: pack.collections,
          topicPlans: pack.topicPlans,
          metrics,
          videos,
          source: pack.source,
          error: null,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '账号分析失败'
        const existing = repo.getReadyByAccountId(accountId)
        if (existing) throw new Error(message)
        return repo.upsert({
          accountId,
          status: 'failed',
          diagnosis: null,
          portrait: null,
          collections: [],
          topicPlans: [],
          metrics: null,
          videos: [],
          source: 'fallback',
          error: message,
        })
      }
    },

    getVideoAnalysis: async (accountId, awemeId) => {
      resolveAccount(tikhub, accountId)
      const detail = repo.getReadyByAccountId(accountId)
      if (!detail) throw new Error('请先完成账号分析')
      const cached = detail.videoAnalyses[awemeId]
      if (cached && Array.isArray(cached.comments) && cached.comments.length > 0) {
        return cached
      }
      const analysis = await buildVideoAnalysis(tikhub, llm, detail, awemeId, false)
      repo.patchVideoAnalysis(accountId, analysis)
      return analysis
    },

    refreshVideoAnalysis: async (accountId, awemeId) => {
      resolveAccount(tikhub, accountId)
      const detail = repo.getReadyByAccountId(accountId)
      if (!detail) throw new Error('请先完成账号分析')
      const analysis = await buildVideoAnalysis(tikhub, llm, detail, awemeId, true)
      repo.patchVideoAnalysis(accountId, analysis)
      return analysis
    },
  }
}
