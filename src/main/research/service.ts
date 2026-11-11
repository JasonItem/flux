import type {
  ResearchAnalyzeResult,
  ResearchVideoDetail,
  ResearchVideoSummary,
} from '../../shared/research'
import type { LlmService } from '../llm/service'
import type { TopicRepository } from '../topic/repository'
import type { TikHubService } from '../tikhub/service'
import { analyzeResearchWithLlm } from './llmAnalyze'
import { buildMockResearchVideos, toPendingDraft } from './mockAnalyze'
import type { ResearchRepository } from './repository'
import {
  buildPendingResearchFromSamples,
  buildRuleResearchFromSamples,
} from './ruleAnalyze'
import type { ResearchSampleInput } from './sampleTypes'

export interface ResearchService {
  listVideos: (topicId: string) => ResearchVideoSummary[]
  analyzeTopic: (topicId: string) => Promise<ResearchAnalyzeResult>
  getVideo: (id: string) => Promise<ResearchVideoDetail>
  refreshVideo: (id: string) => Promise<ResearchVideoDetail>
  enrichTopicMedia: (topicId: string) => Promise<ResearchVideoSummary[]>
  enrichVideoMedia: (id: string) => Promise<ResearchVideoSummary>
}

async function refreshVideoMedia(
  research: ResearchRepository,
  tikhub: TikHubService,
  id: string,
  awemeId: string,
  forcePlayRefresh = false,
): Promise<ResearchVideoSummary> {
  const current = research.getVideo(id)
  const needCover = !current.coverUrl
  const needPlay = !current.playUrl || forcePlayRefresh
  if (!needCover && !needPlay) return current

  try {
    const one = await tikhub.fetchOneVideo(awemeId)
    if (!one) return current
    return research.updateVideoMedia(id, {
      coverUrl: one.coverUrl || undefined,
      playUrl: one.playUrl || undefined,
      durationSec: one.durationMs ? Math.max(5, Math.round(one.durationMs / 1000)) : undefined,
    })
  } catch {
    return current
  }
}

function toDurationSec(durationMs: number | null | undefined): number {
  if (!durationMs || durationMs <= 0) return 45
  return Math.max(5, Math.round(durationMs / 1000))
}

export function createResearchService(
  research: ResearchRepository,
  topics: TopicRepository,
  llm: LlmService,
  tikhub: TikHubService,
): ResearchService {
  return {
    listVideos: (topicId) => {
      topics.getById(topicId)
      return research.listByTopic(topicId)
    },

    analyzeTopic: async (topicId) => {
      const topic = topics.getById(topicId)

      let samples: ResearchSampleInput[] = []
      try {
        const TARGET_SAMPLES = 100
        const byId = new Map<string, Awaited<ReturnType<TikHubService['searchVideos']>>[number]>()

        const buildQueries = (title: string): string[] => {
          const cleaned = title.replace(/\s+/g, ' ').trim()
          const parts = cleaned
            .split(/[·\-—|｜/／、，,]+/)
            .map((item) => item.trim())
            .filter((item) => item.length >= 2)
          const compact = cleaned.replace(/\s+/g, '')
          const queries = [cleaned, ...parts]
          if (compact.length >= 4) queries.push(compact.slice(0, 4))
          if (compact.length >= 6) queries.push(compact.slice(0, 6))
          return [...new Set(queries.filter(Boolean))].slice(0, 5)
        }

        const mergeSearch = async (
          keyword: string,
          sortType: '0' | '1' | '2',
          pages: number,
        ) => {
          try {
            const found = await tikhub.searchVideos(keyword, { sortType, pages })
            for (const item of found) {
              const key = item.awemeId || `${item.authorNickname}-${item.description.slice(0, 24)}`
              if (!key || byId.has(key)) continue
              byId.set(key, item)
            }
          } catch {
            // 单路失败不阻断
          }
        }

        const queries = buildQueries(topic.title)
        // 多关键词 × 热门/综合/最新，尽量拉满到 100
        await Promise.all(
          queries.flatMap((query) => [
            mergeSearch(query, '1', 5),
            mergeSearch(query, '0', 4),
            mergeSearch(query, '2', 3),
          ]),
        )
        const picked = [...byId.values()]
          .sort(
            (a, b) =>
              b.diggCount + b.commentCount * 2 - (a.diggCount + a.commentCount * 2),
          )
          .slice(0, TARGET_SAMPLES)

        samples = await Promise.all(
          picked.map(async (video, index) => {
            let comments: ResearchSampleInput['comments'] = []
            // 前几条抓评论预览，控制耗时与费用；完整拆解仍延后到点详情
            if (index < 8) {
              try {
                const raw = await tikhub.listVideoComments(video.awemeId, 20)
                const mapComment = (
                  item: (typeof raw)[number],
                  path: string,
                ): ResearchSampleInput['comments'][number] => {
                  const replyRate =
                    item.diggCount > 0
                      ? Number((item.replyCount / item.diggCount).toFixed(3))
                      : 0
                  const replies = item.replies.map((child, childIndex) =>
                    mapComment(child, `${path}.${String(childIndex)}`),
                  )
                  return {
                    id: item.cid || path,
                    author: item.author,
                    avatarUrl: item.avatarUrl,
                    content: item.content,
                    diggCount: item.diggCount,
                    replyCount: Math.max(item.replyCount, replies.length),
                    replyRate,
                    qualityScore: Math.min(
                      99,
                      Math.round(item.diggCount * 0.05 + item.replyCount * 1.8),
                    ),
                    replies,
                  }
                }
                comments = raw.map((item, commentIndex) =>
                  mapComment(item, `${video.awemeId}-${String(commentIndex)}`),
                )
              } catch {
                comments = []
              }
            }

            return {
              awemeId: video.awemeId,
              title: video.description?.trim() || `样本视频 ${String(index + 1)}`,
              description: video.description ?? '',
              authorNickname: video.authorNickname,
              authorUniqueId: video.authorUniqueId,
              coverUrl: video.coverUrl,
              playUrl: video.playUrl,
              diggCount: video.diggCount,
              commentCount: video.commentCount,
              shareCount: video.shareCount,
              durationSec: toDurationSec(video.durationMs),
              profileUrl:
                video.shareUrl ||
                (video.awemeId
                  ? `https://www.douyin.com/video/${video.awemeId}`
                  : video.authorSecUid
                    ? `https://www.douyin.com/user/${video.authorSecUid}`
                    : ''),
              matchHint: Math.max(55, 95 - index * 4),
              comments,
            } satisfies ResearchSampleInput
          }),
        )
      } catch {
        samples = []
      }

      // 搜索结果经常缺封面/直链：缺的再按 aweme_id 补一条详情（控制在样本数内）
      if (samples.length > 0) {
        samples = await Promise.all(
          samples.map(async (sample) => {
            if (sample.coverUrl && sample.playUrl) return sample
            if (!sample.awemeId) return sample
            try {
              const one = await tikhub.fetchOneVideo(sample.awemeId)
              if (!one) return sample
              return {
                ...sample,
                coverUrl: sample.coverUrl || one.coverUrl,
                playUrl: sample.playUrl || one.playUrl,
                durationSec:
                  sample.durationSec ||
                  (one.durationMs ? toDurationSec(one.durationMs) : sample.durationSec),
              }
            } catch {
              return sample
            }
          }),
        )
      }

      const pendingDrafts =
        samples.length === 0
          ? buildMockResearchVideos(topic).map(toPendingDraft)
          : buildPendingResearchFromSamples(topic, samples)

      return {
        videos: research.replaceTopicVideos(
          topicId,
          topic.accountId,
          topic.title,
          pendingDrafts,
          'pending',
        ),
        source: 'fallback',
        note:
          samples.length === 0
            ? '视频搜索失败或无结果，已使用本地示意样本；点进详情后再拆解'
            : '已筛选样本，点进详情后才做文案/结构/评论拆解',
      }
    },

    enrichTopicMedia: async (topicId) => {
      topics.getById(topicId)
      const list = research.listByTopic(topicId)
      await Promise.all(
        list.map(async (item) => {
          const awemeId = item.awemeId?.trim()
          if (!awemeId) return
          if (item.coverUrl && item.playUrl) return
          await refreshVideoMedia(research, tikhub, item.id, awemeId)
        }),
      )
      return research.listByTopic(topicId)
    },

    enrichVideoMedia: async (id) => {
      const source = research.getVideoSource(id)
      const awemeId = source.awemeId?.trim() || ''
      if (!awemeId) return source.detail
      return refreshVideoMedia(research, tikhub, id, awemeId, true)
    },

    getVideo: async (id) => {
      const source = research.getVideoSource(id)
      // 已拆解：直接读本地库，不再请求 TikHub / LLM
      if (source.detail.status === 'ready') return source.detail
      return dissectVideo(research, topics, llm, tikhub, id)
    },

    refreshVideo: async (id) => dissectVideo(research, topics, llm, tikhub, id, true),
  }
}

async function dissectVideo(
  research: ResearchRepository,
  topics: TopicRepository,
  llm: LlmService,
  tikhub: TikHubService,
  id: string,
  force = false,
): Promise<ResearchVideoDetail> {
  let source = research.getVideoSource(id)
  const awemeId = source.awemeId?.trim() || ''

  if (awemeId) {
    try {
      // 首次拆解补缺；手动刷新强制更新直链
      await refreshVideoMedia(research, tikhub, id, awemeId, force || !source.detail.playUrl)
      source = research.getVideoSource(id)
    } catch {
      // 补媒体失败不阻断拆解
    }
  }

  if (!force && source.detail.status === 'ready') return source.detail

  const topic = topics.getById(source.detail.topicId)
  const sample: ResearchSampleInput = {
    awemeId: awemeId || source.detail.id,
    title: source.detail.title,
    description: source.description,
    authorNickname: source.detail.authorNickname,
    authorUniqueId: source.detail.authorUniqueId,
    coverUrl: source.detail.coverUrl,
    playUrl: source.detail.playUrl,
    diggCount: source.detail.diggCount,
    commentCount: source.detail.commentCount,
    shareCount: source.detail.shareCount,
    durationSec: source.detail.durationSec,
    profileUrl: source.detail.profileUrl,
    matchHint: source.detail.matchScore,
    comments: source.detail.comments,
  }

  let draft = buildRuleResearchFromSamples(topic, [sample])[0]!
  try {
    const llmResult = await analyzeResearchWithLlm(llm, topic, [sample])
    if (llmResult.source === 'llm' && llmResult.drafts[0]) {
      draft = {
        ...llmResult.drafts[0],
        coverUrl: llmResult.drafts[0].coverUrl || sample.coverUrl,
        playUrl: llmResult.drafts[0].playUrl || sample.playUrl,
      }
    }
  } catch {
    // 本地规则拆解已足够可用
  }

  draft = {
    ...draft,
    coverUrl: draft.coverUrl || sample.coverUrl,
    playUrl: draft.playUrl || sample.playUrl,
  }

  return research.saveVideoAnalysis(id, draft)
}
