import { randomUUID } from 'node:crypto'

import type {
  AccountAnalysisDiagnosis,
  AccountAnalysisMetrics,
  AccountAnalysisVideoRow,
  AccountPortraitBlock,
  AccountPortraitBundle,
  AccountPortraitSlice,
  AccountTopicPlan,
  AccountVideoAnalysis,
  AccountVideoComment,
  AccountWorkCollection,
} from '../../shared/accountAnalysis'
import type { DouyinAccount } from '../../shared/tikhub'
import { asNumber, asRecord, asStringArray, extractJsonValue } from '../llm/json'
import type { LlmService } from '../llm/service'
import {
  buildRuleAccountDiagnosis,
  buildRuleCollections,
  buildRulePortraitBundle,
  buildRuleTopicPlans,
  buildRuleVideoAnalysis,
  sanitizeInterestLabels,
} from './mockAnalyze'

function parseSlices(raw: unknown): AccountPortraitSlice[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const row = asRecord(item)
      if (!row) return null
      const label = String(row.label ?? '').trim()
      if (!label) return null
      return { label, share: Math.max(1, Math.min(100, Math.round(asNumber(row.share, 20)))) }
    })
    .filter((item): item is AccountPortraitSlice => Boolean(item))
    .slice(0, 6)
}

function parseInterestSlices(
  raw: unknown,
  fallback: AccountPortraitSlice[],
): AccountPortraitSlice[] {
  const parsed = parseSlices(raw)
  if (parsed.length === 0) return fallback
  const cleanLabels = sanitizeInterestLabels(parsed.map((item) => item.label))
  if (cleanLabels.length === 0) return fallback
  const shareMap = new Map(parsed.map((item) => [item.label, item.share]))
  const slices = cleanLabels.map((label, index) => ({
    label,
    share: shareMap.get(label) ?? Math.max(12, 36 - index * 5),
  }))
  const total = slices.reduce((sum, item) => sum + item.share, 0) || 1
  return slices.map((item) => ({
    ...item,
    share: Math.round((item.share / total) * 100),
  }))
}

function parsePortraitBlock(raw: unknown, fallback: AccountPortraitBlock): AccountPortraitBlock {
  const row = asRecord(raw)
  if (!row) return fallback
  return {
    summary: String(row.summary ?? fallback.summary).trim() || fallback.summary,
    gender: parseSlices(row.gender).length > 0 ? parseSlices(row.gender) : fallback.gender,
    age: parseSlices(row.age).length > 0 ? parseSlices(row.age) : fallback.age,
    interests: parseInterestSlices(row.interests, fallback.interests),
    motivations: asStringArray(row.motivations, fallback.motivations).slice(0, 5),
    activeTraits: asStringArray(row.activeTraits, fallback.activeTraits).slice(0, 5),
  }
}

function parsePortraitBundle(
  raw: unknown,
  fallback: AccountPortraitBundle,
): AccountPortraitBundle {
  const row = asRecord(raw)
  if (!row) return fallback
  return {
    note:
      String(row.note ?? fallback.note).trim() ||
      '基于公开作品与评论的推断，非创作者中心官方画像。',
    audience: parsePortraitBlock(row.audience, fallback.audience),
    fans: parsePortraitBlock(row.fans, fallback.fans),
  }
}

function parseDiagnosis(raw: unknown, fallback: AccountAnalysisDiagnosis): AccountAnalysisDiagnosis {
  const row = asRecord(raw) ?? {}
  return {
    stageLabel: String(row.stageLabel ?? fallback.stageLabel).trim() || fallback.stageLabel,
    positioning: String(row.positioning ?? fallback.positioning).trim() || fallback.positioning,
    strengths: asStringArray(row.strengths, fallback.strengths).slice(0, 4),
    weaknesses: asStringArray(row.weaknesses, fallback.weaknesses).slice(0, 4),
    postingCadence:
      String(row.postingCadence ?? fallback.postingCadence).trim() || fallback.postingCadence,
    durationInsight:
      String(row.durationInsight ?? fallback.durationInsight).trim() || fallback.durationInsight,
    trackAlignment:
      row.trackAlignment === null
        ? null
        : String(row.trackAlignment ?? fallback.trackAlignment ?? '').trim() ||
          fallback.trackAlignment,
  }
}

export interface AccountInsightPack {
  diagnosis: AccountAnalysisDiagnosis
  portrait: AccountPortraitBundle
  collections: AccountWorkCollection[]
  topicPlans: AccountTopicPlan[]
  videos: AccountAnalysisVideoRow[]
  source: 'llm' | 'fallback'
}

export async function analyzeAccountInsightsWithLlm(
  llm: LlmService,
  input: {
    account: DouyinAccount
    metrics: AccountAnalysisMetrics
    videos: AccountAnalysisVideoRow[]
    trackName: string | null
    commentSnippets: string[]
  },
): Promise<AccountInsightPack> {
  const diagnosisFallback = buildRuleAccountDiagnosis(input)
  const portraitFallback = buildRulePortraitBundle(input)
  const collectionFallback = buildRuleCollections(input.videos)
  const topicFallback = buildRuleTopicPlans({
    account: input.account,
    videos: collectionFallback.videos,
    trackName: input.trackName,
    portrait: portraitFallback,
  })

  const payload = {
    account: {
      nickname: input.account.nickname,
      uniqueId: input.account.uniqueId,
      followerCount: input.account.followerCount,
      awemeCount: input.account.awemeCount,
      signature: input.account.signature,
    },
    selectedTrack: input.trackName,
    metrics: input.metrics,
    commentSnippets: input.commentSnippets.slice(0, 30),
    videos: input.videos.slice(0, 28).map((item) => ({
      awemeId: item.awemeId,
      title: item.title,
      type: item.videoType,
      tag: item.performanceTag,
      estimatedPlay: item.estimatedPlay,
      digg: item.diggCount,
      comment: item.commentCount,
      relativeScore: item.relativeScore,
      coverUrl: item.coverUrl,
    })),
  }

  try {
    const result = await llm.chat({
      messages: [
        {
          role: 'system',
          content:
            '你是抖音账号运营分析师。只能依据公开作品标题、互动与评论文本做推断画像，禁止伪装成创作者中心官方数据。输出严格 JSON。',
        },
        {
          role: 'user',
          content: `请输出 JSON：
{
  "diagnosis":{"stageLabel":"冷启|稳定|波动|下滑","positioning":"...","strengths":[],"weaknesses":[],"postingCadence":"...","durationInsight":"...","trackAlignment":null},
  "portrait":{
    "note":"基于公开作品与评论的推断...",
    "audience":{"summary":"...","gender":[{"label":"...","share":0-100}],"age":[],"interests":[],"motivations":[],"activeTraits":[]},
    "fans":{"summary":"...","gender":[],"age":[],"interests":[],"motivations":[],"activeTraits":[]}
  },
  "collections":[{"name":"作品集名","share":0-100,"audienceHint":"...","awemeIds":["必须来自输入"]}],
  "topicPlans":[{"title":"...","targetAudience":"...","reason":"...","evidence":[]}]
}

输入：
${JSON.stringify(payload)}`,
        },
      ],
      temperature: 0.35,
    })

    const parsed = asRecord(extractJsonValue(result.content)) ?? {}
    const diagnosis = parseDiagnosis(parsed.diagnosis, diagnosisFallback)
    const portrait = parsePortraitBundle(parsed.portrait, portraitFallback)

    const awemeSet = new Set(input.videos.map((item) => item.awemeId))
    const collectionsRaw = Array.isArray(parsed.collections) ? parsed.collections : []
    const parsedCollections: AccountWorkCollection[] = []
    for (const item of collectionsRaw) {
      const row = asRecord(item)
      if (!row) continue
      const name = String(row.name ?? '').trim()
      if (!name) continue
      const awemeIds = asStringArray(row.awemeIds, []).filter((id) => awemeSet.has(id))
      if (awemeIds.length === 0) continue
      const cover =
        input.videos.find((video) => video.awemeId === awemeIds[0])?.coverUrl ?? null
      parsedCollections.push({
        id: randomUUID(),
        name,
        share: Math.max(1, Math.min(100, Math.round(asNumber(row.share, 20)))),
        audienceHint: String(row.audienceHint ?? '').trim() || '相关受众',
        awemeIds,
        coverUrl: cover,
      })
      if (parsedCollections.length >= 6) break
    }
    const collections =
      parsedCollections.length > 0 ? parsedCollections : collectionFallback.collections

    const collectionByAweme = new Map<string, string>()
    for (const collection of collections) {
      for (const awemeId of collection.awemeIds) collectionByAweme.set(awemeId, collection.id)
    }
    const videos = input.videos.map((item) => ({
      ...item,
      collectionId: collectionByAweme.get(item.awemeId) ?? null,
    }))

    const topicRaw = Array.isArray(parsed.topicPlans) ? parsed.topicPlans : []
    const parsedTopics: AccountTopicPlan[] = []
    for (const item of topicRaw) {
      const row = asRecord(item)
      if (!row) continue
      const title = String(row.title ?? '').trim()
      if (!title) continue
      parsedTopics.push({
        id: randomUUID(),
        title,
        targetAudience: String(row.targetAudience ?? '').trim() || '目标受众',
        reason: String(row.reason ?? '').trim() || '基于近作表现推断',
        evidence: asStringArray(row.evidence, []).slice(0, 4),
      })
      if (parsedTopics.length >= 6) break
    }
    let topicPlans = parsedTopics

    if (topicPlans.length === 0) {
      topicPlans = buildRuleTopicPlans({
        account: input.account,
        videos,
        trackName: input.trackName,
        portrait,
      })
    }

    return { diagnosis, portrait, collections, topicPlans, videos, source: 'llm' }
  } catch {
    return {
      diagnosis: diagnosisFallback,
      portrait: portraitFallback,
      collections: collectionFallback.collections,
      topicPlans: topicFallback,
      videos: collectionFallback.videos,
      source: 'fallback',
    }
  }
}

export async function analyzeVideoWithLlm(
  llm: LlmService,
  input: {
    video: AccountAnalysisVideoRow
    commentSnippets: string[]
    comments?: AccountVideoComment[]
    accountPortrait: AccountPortraitBundle | null
  },
): Promise<AccountVideoAnalysis> {
  const fallback = buildRuleVideoAnalysis(input)
  try {
    const result = await llm.chat({
      messages: [
        {
          role: 'system',
          content:
            '你是短视频内容分析师。根据单条视频标题、互动与评论推断观众/粉丝画像。禁止伪造成官方画像。输出 JSON。interests 必须是受众关心的主题（如跨境外贸、工厂出海），禁止填口播/教程等体裁，禁止填原评论文案或表情。',
        },
        {
          role: 'user',
          content: `返回 JSON：
{
  "portrait":{"note":"...","audience":{"summary":"...","gender":[{"label":"...","share":0-100}],"age":[],"interests":[{"label":"主题兴趣","share":0-100}],"motivations":[],"activeTraits":[]},"fans":{...}},
  "commentThemes":["把评论归成主题，不要当兴趣"],
  "contentTips":["..."]
}

视频：${JSON.stringify({
            title: input.video.title,
            type: input.video.videoType,
            tag: input.video.performanceTag,
            digg: input.video.diggCount,
            comment: input.video.commentCount,
            estimatedPlay: input.video.estimatedPlay,
          })}
账号兴趣参考：${JSON.stringify(
            (input.accountPortrait?.audience.interests ?? []).map((item) => item.label).slice(0, 5),
          )}
评论摘录（仅用于 commentThemes，不要写进 interests）：${JSON.stringify(input.commentSnippets.slice(0, 25))}`,
        },
      ],
      temperature: 0.35,
    })
    const parsed = asRecord(extractJsonValue(result.content)) ?? {}
    return {
      ...fallback,
      portrait: parsePortraitBundle(parsed.portrait, fallback.portrait),
      commentThemes: asStringArray(parsed.commentThemes, fallback.commentThemes).slice(0, 6),
      contentTips: asStringArray(parsed.contentTips, fallback.contentTips).slice(0, 5),
      comments: input.comments ?? fallback.comments,
      sampleCommentCount: (input.comments ?? fallback.comments).length,
      source: 'llm',
      updatedAt: new Date().toISOString(),
    }
  } catch {
    return fallback
  }
}
