import { BrowserWindow } from 'electron'

import {
  researchDissectDedupeKey,
  type StudioJob,
} from '../../shared/jobs'
import type {
  ResearchAnalyzeResult,
  ResearchCommentItem,
  ResearchDissectByUrlInput,
  ResearchDissectByUrlResult,
  ResearchDissectRecordsQuery,
  ResearchDissectRecordsResult,
  ResearchProgressEvent,
  ResearchVideoDetail,
  ResearchVideoSummary,
} from '../../shared/research'
import type { JobService } from '../jobs/service'
import type { LlmService } from '../llm/service'
import type { MediaService } from '../media/service'
import type { TopicRepository } from '../topic/repository'
import type { TikHubService } from '../tikhub/service'
import { resolveDouyinAwemeId } from '../tikhub/resolveVideoInput'
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
  listDissectRecords: (query?: ResearchDissectRecordsQuery) => ResearchDissectRecordsResult
  listCustomVideos: () => ResearchVideoSummary[]
  analyzeTopic: (topicId: string) => Promise<ResearchAnalyzeResult>
  getVideo: (id: string) => Promise<ResearchVideoDetail>
  refreshVideo: (id: string) => Promise<ResearchVideoDetail>
  enqueueDissect: (id: string, options?: { force?: boolean }) => StudioJob
  enqueueDissectByUrl: (input: ResearchDissectByUrlInput) => Promise<ResearchDissectByUrlResult>
  runDissect: (
    id: string,
    force?: boolean,
    hooks?: { onProgress?: (event: ResearchProgressEvent) => void },
  ) => Promise<ResearchVideoDetail>
  enrichTopicMedia: (topicId: string) => Promise<ResearchVideoSummary[]>
  enrichVideoMedia: (id: string) => Promise<ResearchVideoSummary>
  ensureLocalMedia: (id: string, options?: { force?: boolean }) => Promise<ResearchVideoSummary>
}

function mapTikHubComments(
  raw: Awaited<ReturnType<TikHubService['listVideoComments']>>,
  awemeId: string,
): ResearchCommentItem[] {
  const mapComment = (
    item: (typeof raw)[number],
    path: string,
  ): ResearchCommentItem => {
    const replies = item.replies.map((child, childIndex) =>
      mapComment(child, `${path}.${String(childIndex)}`),
    )
    const replyRate =
      item.diggCount > 0 ? Number((item.replyCount / item.diggCount).toFixed(3)) : 0
    return {
      id: item.cid || path,
      author: item.author,
      avatarUrl: item.avatarUrl,
      content: item.content,
      diggCount: item.diggCount,
      replyCount: Math.max(item.replyCount, replies.length),
      replyRate,
      qualityScore: Math.min(99, Math.round(item.diggCount * 0.05 + item.replyCount * 1.8)),
      replies,
    }
  }
  return raw.map((item, index) => mapComment(item, `${awemeId}-${String(index)}`))
}

async function ensureVideoComments(
  research: ResearchRepository,
  tikhub: TikHubService,
  id: string,
  options?: { force?: boolean; minCount?: number },
): Promise<ResearchVideoDetail> {
  const source = research.getVideoSource(id)
  const awemeId = source.awemeId?.trim() || ''
  const reported = Math.max(0, source.detail.commentCount || 0)
  const have = source.detail.comments.length
  // 目标：尽量多拉一级评论样本（上限 400），至少盖住视频评论量的一部分
  const target = Math.min(400, Math.max(options?.minCount ?? 80, reported > 0 ? Math.min(reported, 400) : 80))
  if (!awemeId) return source.detail
  if (!options?.force && have >= Math.min(target, 80)) return source.detail
  try {
    const raw = await tikhub.listVideoComments(awemeId, target)
    const comments = mapTikHubComments(raw, awemeId)
    if (comments.length === 0) return source.detail
    // 比已有更少就不覆盖（避免网络失败把样本冲掉）
    if (!options?.force && comments.length <= have) return source.detail
    return research.updateVideoComments(id, comments)
  } catch {
    return source.detail
  }
}

function emitResearchProgress(event: ResearchProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('research:progress', event)
  }
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

function hasUsableDissect(detail: ResearchVideoDetail): boolean {
  return Boolean(detail.fullTranscript?.trim())
}

function markDissectReady(research: ResearchRepository, id: string): ResearchVideoDetail {
  return research.updateDissectProgress(id, {
    dissectStatus: 'ready',
    dissectError: null,
    status: 'ready',
  })
}

function enqueueDissectJob(
  jobs: JobService,
  research: ResearchRepository,
  id: string,
  force = false,
): StudioJob {
  const detail = research.getVideo(id)
  // 已有转写结果时，非 force 不再重复入队（避免进详情页反复「任务完成」）
  if (!force && hasUsableDissect(detail)) {
    if (detail.dissectStatus !== 'ready' || detail.status !== 'ready') {
      markDissectReady(research, id)
    }
    const related = jobs.list().filter((job) => job.dedupeKey === researchDissectDedupeKey(id))
    const active = related.find((job) => job.status === 'queued' || job.status === 'running')
    if (active) return active
    const done = related.find((job) => job.status === 'succeeded')
    if (done) return done
    const stamp = new Date().toISOString()
    return {
      id: `local-ready:${id}`,
      kind: 'research.dissect',
      title: `拆解：${detail.title.slice(0, 40)}`,
      status: 'succeeded',
      phase: 'ready',
      message: '已有拆解结果',
      percent: 100,
      href: `/research/video/${encodeURIComponent(id)}`,
      dedupeKey: researchDissectDedupeKey(id),
      payload: { videoId: id, force: false },
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: stamp,
    }
  }

  const job = jobs.enqueue({
    kind: 'research.dissect',
    title: `拆解：${detail.title.slice(0, 40)}`,
    href: `/research/video/${encodeURIComponent(id)}`,
    dedupeKey: researchDissectDedupeKey(id),
    payload: { videoId: id, force },
    force,
  })
  if (job.status === 'queued' || job.status === 'running') {
    try {
      research.updateDissectProgress(id, {
        dissectStatus: 'pending',
        dissectError: null,
        status: hasUsableDissect(detail) ? 'ready' : 'pending',
      })
    } catch {
      // ignore
    }
  }
  return job
}

export function createResearchService(
  research: ResearchRepository,
  topics: TopicRepository,
  llm: LlmService,
  tikhub: TikHubService,
  media: MediaService,
  jobs: JobService,
): ResearchService {
  return {
    listVideos: (topicId) => {
      topics.getById(topicId)
      return research.listByTopic(topicId)
    },

    listDissectRecords: (query) => research.listDissectRecords(query),

    listCustomVideos: () => research.listCustomVideos(50),

    enqueueDissectByUrl: async (input) => {
      const url = input.url?.trim() || ''
      if (!url) throw new Error('请粘贴抖音视频链接')

      let topicId = input.topicId?.trim() || ''
      let topic = topicId ? topics.getById(topicId) : null
      if (!topic) {
        const accounts = tikhub.listAccounts()
        const account =
          accounts.find((item) => item.isActive) || accounts[0] || null
        if (!account) {
          throw new Error('请先在设置里绑定抖音账号，再添加自定义拆解')
        }
        const existing = topics
          .list(account.id)
          .find((item) => item.title === '自定义拆解' && item.source === 'manual')
        topic =
          existing ||
          topics.addManual({
            accountId: account.id,
            title: '自定义拆解',
            summary: '通过粘贴视频链接添加的拆解任务',
            reason: '自定义链接拆解',
            domain: '自定义',
          })
        topicId = topic.id
      }

      const awemeId = await resolveDouyinAwemeId(url)
      const existed = research.findByAwemeId(awemeId)
      const shareCandidate =
        /https?:\/\/[^\s<>"']+/i.exec(url)?.[0]?.replace(/[),.;!?，。；！？]+$/g, '') ||
        `https://www.douyin.com/video/${awemeId}`

      let one: Awaited<ReturnType<TikHubService['fetchOneVideo']>> = null
      let fetchError: string | null = null
      try {
        one = await tikhub.fetchOneVideo(awemeId)
      } catch (error) {
        fetchError = error instanceof Error ? error.message : '按 ID 拉取失败'
      }
      if (!one) {
        try {
          one = await tikhub.fetchOneVideoByShareUrl(shareCandidate)
        } catch (error) {
          const message = error instanceof Error ? error.message : '按链接拉取失败'
          fetchError = fetchError ? `${fetchError}；${message}` : message
        }
      }

      // 详情接口偶发空响应时，仍可用 aweme_id 建任务，拆解阶段再补媒体
      const title =
        one?.description?.trim() ||
        existed?.title ||
        `抖音视频 ${awemeId.slice(-6)}`
      if (!one && !existed) {
        // 仅提示，不阻断入队
        console.warn('[research] custom dissect meta empty', awemeId, fetchError)
      }

      const video = research.upsertCustomVideo(topicId, topic.accountId, {
        awemeId,
        title,
        authorNickname: one?.authorNickname || existed?.authorNickname || '未知作者',
        authorUniqueId: one?.authorUniqueId || existed?.authorUniqueId || null,
        coverUrl: one?.coverUrl || existed?.coverUrl || null,
        playUrl: one?.playUrl || existed?.playUrl || null,
        diggCount: one?.diggCount || existed?.diggCount || 0,
        commentCount: one?.commentCount || existed?.commentCount || 0,
        shareCount: one?.shareCount || existed?.shareCount || 0,
        durationSec:
          (one?.durationMs ? toDurationSec(one.durationMs) : 0) || existed?.durationSec || 45,
        videoType: existed?.videoType || '口播',
        matchScore: 100,
        profileUrl:
          one?.shareUrl ||
          (awemeId ? `https://www.douyin.com/video/${awemeId}` : existed?.profileUrl || ''),
        description: one?.description || title,
        summary: '自定义链接拆解',
        editingStyle: '',
        scriptSegments: [],
        structureBlocks: [],
        comments: [],
        takeaways: [],
      })

      const force = Boolean(input.force) || !hasUsableDissect(research.getVideo(video.id))
      const job = enqueueDissectJob(jobs, research, video.id, force)
      return {
        video,
        job,
        created: !existed,
      }
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
                const raw = await tikhub.listVideoComments(
                  video.awemeId,
                  Math.min(120, Math.max(40, video.commentCount || 40)),
                )
                comments = mapTikHubComments(raw, video.awemeId)
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

    ensureLocalMedia: async (id, options = {}) => {
      await media.ensureResearchVideo(id, options)
      return research.getVideo(id)
    },

    enqueueDissect: (id, options = {}) =>
      enqueueDissectJob(jobs, research, id, Boolean(options.force)),

    getVideo: async (id) => {
      // 先秒回本地详情，避免评论接口拖住整页加载框
      let detail = research.getVideo(id)
      if (hasUsableDissect(detail)) {
        if (detail.dissectStatus !== 'ready' || detail.status !== 'ready') {
          detail = markDissectReady(research, id)
        }
        return detail
      }
      // 失败态不自动重试；点「刷新」才同步数据或重新入队
      if (detail.dissectStatus === 'error') {
        return detail
      }
      enqueueDissectJob(jobs, research, id, false)
      return research.getVideo(id)
    },

    refreshVideo: async (id) => {
      let current = research.getVideo(id)
      const awemeId = current.awemeId?.trim() || ''
      // 已有转写：只同步点赞/评论等，不重跑下载/转写/大模型
      if (hasUsableDissect(current) && awemeId) {
        if (current.dissectStatus !== 'ready' || current.status !== 'ready') {
          current = markDissectReady(research, id)
        }
        try {
          const one = await tikhub.fetchOneVideo(awemeId)
          if (one) {
            research.updateVideoStats(id, {
              diggCount: one.diggCount,
              commentCount: one.commentCount,
              shareCount: one.shareCount,
              coverUrl: one.coverUrl || undefined,
              playUrl: one.playUrl || undefined,
              durationSec: one.durationMs ? toDurationSec(one.durationMs) : undefined,
              title: one.description?.trim() || undefined,
            })
          }
        } catch {
          // keep prior stats
        }
        return ensureVideoComments(research, tikhub, id, { force: true, minCount: 1 })
      }
      // 未拆解完成：才入队完整拆解
      enqueueDissectJob(jobs, research, id, false)
      return research.getVideo(id)
    },

    runDissect: (id, force = false, hooks) =>
      dissectVideo(research, topics, llm, media, tikhub, id, force, hooks),
  }
}

const dissectInflight = new Map<string, Promise<ResearchVideoDetail>>()

async function dissectVideo(
  research: ResearchRepository,
  topics: TopicRepository,
  llm: LlmService,
  media: MediaService,
  tikhub: TikHubService,
  id: string,
  force = false,
  hooks?: { onProgress?: (event: ResearchProgressEvent) => void },
): Promise<ResearchVideoDetail> {
  const key = `${id}:${force ? '1' : '0'}`
  const existing = dissectInflight.get(key)
  if (existing) return existing

  const run = runDissectVideo(research, topics, llm, media, tikhub, id, force, hooks).finally(
    () => {
      dissectInflight.delete(key)
    },
  )
  dissectInflight.set(key, run)
  return run
}

async function runDissectVideo(
  research: ResearchRepository,
  topics: TopicRepository,
  llm: LlmService,
  media: MediaService,
  tikhub: TikHubService,
  id: string,
  force = false,
  hooks?: { onProgress?: (event: ResearchProgressEvent) => void },
): Promise<ResearchVideoDetail> {
  let source = research.getVideoSource(id)
  const awemeId = source.awemeId?.trim() || ''
  const topic = topics.getById(source.detail.topicId)

  if (!force && hasUsableDissect(source.detail)) {
    const restored = markDissectReady(research, id)
    const withComments = await ensureVideoComments(research, tikhub, id)
    return withComments.comments.length > 0 ? withComments : restored
  }

  const progress = (phase: ResearchProgressEvent['phase'], message: string, percent?: number) => {
    const event = { videoId: id, awemeId, phase, message, percent }
    emitResearchProgress(event)
    hooks?.onProgress?.(event)
  }

  let mediaReady = source.detail.mediaStatus === 'ready'

  try {
    research.updateDissectProgress(id, {
      dissectStatus: 'downloading',
      dissectError: null,
      status: 'pending',
    })
    progress('downloading', '正在下载视频到本地…', 5)

    if (!awemeId) {
      throw new Error('缺少 aweme_id，无法下载并转写原视频')
    }

    // 重新分析默认复用已有本地缓存，避免 force 重下把好文件覆盖坏
    const ensured = await media.ensureByAwemeId(awemeId, {
      playUrl: source.detail.playUrl,
      force: false,
    })
    research.updateVideoMedia(id, {
      playUrl: ensured.playUrl,
      localPath: ensured.localPath,
      mediaStatus: 'ready',
    })
    mediaReady = true

    research.updateDissectProgress(id, { dissectStatus: 'transcribing' })
    progress('transcribing', '正在语音转写原视频文案…', 25)

    const transcript = await media.transcribeAweme(awemeId, {
      researchVideoId: id,
      onProgress: (message, percent) => {
        progress('transcribing', message, percent)
      },
    })
    research.updateDissectProgress(id, {
      dissectStatus: 'analyzing',
      fullTranscript: transcript.fullTranscript,
      transcriptCues: transcript.cues,
    })
    progress('analyzing', '正在用大模型做结构/剪辑/文案总结…', 70)

    const withComments = await ensureVideoComments(research, tikhub, id, {
      force: source.detail.comments.length < 8,
      minCount: 8,
    })
    source = research.getVideoSource(id)
    const sample: ResearchSampleInput = {
      awemeId,
      title: source.detail.title,
      description: source.description,
      authorNickname: source.detail.authorNickname,
      authorUniqueId: source.detail.authorUniqueId,
      coverUrl: source.detail.coverUrl,
      playUrl: ensured.playUrl,
      diggCount: source.detail.diggCount,
      commentCount: source.detail.commentCount,
      shareCount: source.detail.shareCount,
      durationSec: source.detail.durationSec,
      profileUrl: source.detail.profileUrl,
      matchHint: source.detail.matchScore,
      comments: withComments.comments,
      fullTranscript: transcript.fullTranscript,
      transcriptCues: transcript.cues,
    }

    let draft = buildRuleResearchFromSamples(topic, [sample])[0]!
    draft = {
      ...draft,
      fullTranscript: transcript.fullTranscript,
      transcriptCues: transcript.cues,
      summary: transcript.fullTranscript
        ? `原转写约 ${String(transcript.fullTranscript.length)} 字，待模型总结`
        : '无可用转写',
    }

    try {
      const llmResult = await analyzeResearchWithLlm(llm, topic, [sample])
      if (llmResult.drafts[0]) {
        draft = {
          ...llmResult.drafts[0],
          coverUrl: llmResult.drafts[0].coverUrl || sample.coverUrl,
          playUrl: ensured.playUrl,
          fullTranscript: transcript.fullTranscript,
          transcriptCues: transcript.cues,
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '大模型分析失败'
      draft = {
        ...draft,
        summary: `已完成转写，但大模型分析失败：${message}`,
        takeaways: ['可先阅读「原视频文案」，稍后再点重新分析'],
      }
    }

    const saved = research.saveVideoAnalysis(id, {
      ...draft,
      playUrl: ensured.playUrl,
      fullTranscript: transcript.fullTranscript,
      transcriptCues: transcript.cues,
    })
    progress('ready', '拆解完成', 100)
    return saved
  } catch (error) {
    const message = error instanceof Error ? error.message : '拆解失败'
    research.updateDissectProgress(id, {
      dissectStatus: 'error',
      dissectError: message,
      // Keep status ready-ish for playback when local media exists
      status: mediaReady ? 'ready' : 'error',
    })
    progress('error', message)
    // Prefer returning playable detail over hard failure (ASR/network issues)
    if (mediaReady) {
      return research.getVideo(id)
    }
    throw error
  }
}
