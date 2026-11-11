import type {
  ResearchCommentItem,
  ResearchScriptSegment,
  ResearchStructureBlock,
  ResearchVideoType,
} from '../../shared/research'
import type { TopicItem } from '../../shared/topic'
import { asNumber, asRecord, asStringArray, clampScore, extractJsonValue } from '../llm/json'
import type { LlmService } from '../llm/service'
import type { ResearchVideoDraft } from './mockAnalyze'
import { buildMockResearchVideos } from './mockAnalyze'
import { buildRuleResearchFromSamples } from './ruleAnalyze'
import type { ResearchSampleInput } from './sampleTypes'

const VIDEO_TYPES: ResearchVideoType[] = [
  '口播',
  '带货',
  '探店',
  '教程',
  '剧情',
  '资讯',
  '其他',
]

function parseVideoType(value: unknown): ResearchVideoType {
  const text = String(value ?? '').trim()
  return (VIDEO_TYPES.find((item) => item === text) ?? '其他') as ResearchVideoType
}

function parseSegments(raw: unknown): ResearchScriptSegment[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const row = asRecord(item)
      if (!row) return null
      const label = String(row.label ?? '').trim()
      const text = String(row.text ?? '').trim()
      if (!label || !text) return null
      return {
        label,
        purpose: String(row.purpose ?? '讲点').trim(),
        text,
      }
    })
    .filter((item): item is ResearchScriptSegment => Boolean(item))
    .slice(0, 6)
}

function parseBlocks(raw: unknown, durationSec: number): ResearchStructureBlock[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const row = asRecord(item)
      if (!row) return null
      const title = String(row.title ?? '').trim()
      if (!title) return null
      const startSec = Math.max(0, asNumber(row.startSec, 0))
      const endSec = Math.max(startSec + 1, asNumber(row.endSec, Math.min(durationSec, startSec + 8)))
      return {
        startSec,
        endSec: Math.min(endSec, Math.max(durationSec, endSec)),
        title,
        purpose: String(row.purpose ?? '讲点').trim(),
        editingStyle: String(row.editingStyle ?? row.editStyle ?? '').trim() || `${title}段：按目的匹配切点与字幕密度`,
      }
    })
    .filter((item): item is ResearchStructureBlock => Boolean(item))
    .slice(0, 8)
}

function parseComments(raw: unknown, fallback: ResearchCommentItem[]): ResearchCommentItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback.slice(0, 8)
  return raw
    .map((item) => {
      const row = asRecord(item)
      if (!row) return null
      const content = String(row.content ?? '').trim()
      if (!content) return null
      const diggCount = asNumber(row.diggCount, 0)
      const replyCount = asNumber(row.replyCount, 0)
      const replyRate =
        typeof row.replyRate === 'number'
          ? row.replyRate
          : diggCount > 0
            ? Number((replyCount / diggCount).toFixed(3))
            : 0
      const repliesRaw = Array.isArray(row.replies) ? row.replies : []
      const replies = parseComments(repliesRaw, []).slice(0, 8)
      return {
        id: String(row.id ?? content.slice(0, 12) + String(diggCount)),
        author: String(row.author ?? '用户').trim() || '用户',
        avatarUrl: typeof row.avatarUrl === 'string' ? row.avatarUrl : null,
        content,
        diggCount,
        replyCount: Math.max(replyCount, replies.length),
        replyRate,
        qualityScore: clampScore(asNumber(row.qualityScore, diggCount * 0.05 + replyCount * 1.5)),
        replies,
      }
    })
    .filter((item): item is ResearchCommentItem => Boolean(item))
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 18)
}

function rankComments(comments: ResearchCommentItem[]): ResearchCommentItem[] {
  const score = (item: ResearchCommentItem): ResearchCommentItem => ({
    ...item,
    qualityScore: clampScore(item.diggCount * 0.05 + item.replyCount * 1.8 + item.replyRate * 40),
    replies: item.replies.map(score),
  })
  return [...comments]
    .map(score)
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 18)
}

function parseDrafts(
  raw: unknown,
  samples: ResearchSampleInput[],
): ResearchVideoDraft[] {
  const root = asRecord(raw)
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(root?.videos)
      ? root.videos
      : null
  if (!list) throw new Error('研究室分析结果格式无效')

  const byId = new Map(samples.map((item) => [item.awemeId, item]))
  const drafts: ResearchVideoDraft[] = []

  for (const [index, item] of list.entries()) {
    const row = asRecord(item)
    if (!row) continue
    const awemeId = String(row.awemeId ?? samples[index]?.awemeId ?? '').trim()
    const sample = byId.get(awemeId) ?? samples[index]
    if (!sample) continue

    const ranked = rankComments(sample.comments)
    const durationSec = sample.durationSec || 45
    const scriptSegments = parseSegments(row.scriptSegments)
    const parsedBlocks = parseBlocks(row.structureBlocks, durationSec)
    const structureBlocks: ResearchStructureBlock[] =
      parsedBlocks.length > 0
        ? parsedBlocks
        : [
            {
              startSec: 0,
              endSec: 3,
              title: '钩子',
              purpose: '留人',
              editingStyle: '近景急推 + 关键词闪入，切点落在痛点词上',
            },
            {
              startSec: 3,
              endSec: Math.max(10, durationSec - 6),
              title: '主体',
              purpose: '讲点',
              editingStyle: '口播/示意图交替，字幕密度升高，硬切为主',
            },
            {
              startSec: Math.max(10, durationSec - 6),
              endSec: durationSec,
              title: '收束',
              purpose: '互动',
              editingStyle: '镜头推近，提问字幕置底，留停顿',
            },
          ]
    const editingStyleJoined = structureBlocks
      .map((block) => `${block.title}：${block.editingStyle}`)
      .join('；')

    drafts.push({
      awemeId: sample.awemeId,
      coverUrl: sample.coverUrl,
      playUrl: sample.playUrl,
      title: String(row.title ?? sample.title).trim() || sample.title,
      authorNickname: sample.authorNickname,
      authorUniqueId: sample.authorUniqueId,
      diggCount: sample.diggCount,
      commentCount: sample.commentCount,
      shareCount: sample.shareCount,
      durationSec,
      videoType: parseVideoType(row.videoType),
      matchScore: clampScore(asNumber(row.matchScore, sample.matchHint ?? 70 - index * 3)),
      profileUrl: sample.profileUrl,
      summary: String(row.summary ?? sample.title).trim(),
      scriptSegments:
        scriptSegments.length > 0
          ? scriptSegments
          : [
              {
                label: '开头',
                purpose: '留人',
                text: sample.title.slice(0, 40) || '直接抛出选题痛点',
              },
            ],
      structureBlocks,
      editingStyle: String(row.editingStyle ?? editingStyleJoined).trim() || editingStyleJoined,
      comments: parseComments(row.comments, ranked),
      takeaways: asStringArray(row.takeaways, [
        `可复用「${sample.title.slice(0, 18)}」的开头留人方式`,
      ]).slice(0, 5),
    })
  }

  if (drafts.length === 0) throw new Error('模型未返回可用视频拆解')
  return drafts
}

export async function analyzeResearchWithLlm(
  llm: LlmService,
  topic: TopicItem,
  samples: ResearchSampleInput[],
): Promise<{ drafts: ResearchVideoDraft[]; source: 'llm' | 'fallback'; note?: string }> {
  if (samples.length === 0) {
    return {
      drafts: buildMockResearchVideos(topic),
      source: 'fallback',
      note: '未检索到真实样本，已使用本地示意数据',
    }
  }

  try {
    const payload = samples.map((item, index) => ({
      index: index + 1,
      awemeId: item.awemeId,
      title: item.title,
      author: item.authorNickname,
      digg: item.diggCount,
      comment: item.commentCount,
      share: item.shareCount,
      durationSec: item.durationSec,
      description: item.description.slice(0, 120),
      topComments: rankComments(item.comments)
        .slice(0, 8)
        .map((c) => ({
          author: c.author,
          content: c.content,
          diggCount: c.diggCount,
          replyCount: c.replyCount,
        })),
    }))

    const result = await llm.chat({
      temperature: 0.35,
      maxTokens: 4500,
      messages: [
        {
          role: 'system',
          content: `你是抖音短视频拆解教练。针对给定选题与真实样本视频，输出可执行的文案/结构/类型/评论洞察。
只输出 JSON，不要 markdown。结构：
{
  "videos": [{
    "awemeId":"必须与输入一致",
    "title":"可微调标题",
    "videoType":"口播|带货|探店|教程|剧情|资讯|其他",
    "matchScore":1-100,
    "summary":"一句话摘要",
    "editingStyle":"可省略；优先在 structureBlocks[].editingStyle 写每段剪辑",
    "scriptSegments":[{"label":"段名","purpose":"目的","text":"文案要点"}],
    "structureBlocks":[{"startSec":0,"endSec":3,"title":"钩子","purpose":"留人","editingStyle":"该段镜头/字幕/切点手法"}],
    "comments":[{"author":"","content":"","diggCount":0,"replyCount":0,"replyRate":0,"qualityScore":1-100}],
    "takeaways":["可复用要点"]
  }]
}
structureBlocks 必须为每一段写 editingStyle（镜头、字幕、切点、转场），不要只用整片一句话概括剪辑。
comments 优先从输入 topComments 里挑优质评论（高赞、高回复），可改写精炼但不要编造互动数据。`,
        },
        {
          role: 'user',
          content: `选题：${topic.title}\n选题说明：${topic.summary || topic.reason}\n请拆解以下样本：\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
    })

    return {
      drafts: parseDrafts(extractJsonValue(result.content), samples),
      source: 'llm',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '大模型拆解失败'
    return {
      drafts: buildRuleResearchFromSamples(topic, samples),
      source: 'fallback',
      note: message,
    }
  }
}
