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
  '科普',
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
      const keyLines = asStringArray(row.keyLines, []).slice(0, 4)
      const analysis = String(row.analysis ?? row.text ?? '').trim()
      const block: ResearchStructureBlock = {
        startSec,
        endSec: Math.min(endSec, Math.max(durationSec, endSec)),
        title,
        purpose: String(row.purpose ?? '讲点').trim(),
        editingStyle:
          String(row.editingStyle ?? row.editStyle ?? '').trim() ||
          `${title}段：按口播节奏与字幕密度推断切点`,
      }
      if (analysis) block.analysis = analysis
      if (keyLines.length > 0) block.keyLines = keyLines
      return block
    })
    .filter((item): item is ResearchStructureBlock => Boolean(item))
    .slice(0, 16)
}

function parseComments(raw: unknown, fallback: ResearchCommentItem[]): ResearchCommentItem[] {
  // Prefer real TikHub comments — LLM often returns empty/fake rows
  if (fallback.length > 0) return fallback.slice(0, 400)
  if (!Array.isArray(raw) || raw.length === 0) return []
  const parsed = raw
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
      const replies = parseComments(repliesRaw, []).slice(0, 12)
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
    .slice(0, 400)
  return parsed.length > 0 ? parsed : fallback.slice(0, 400)
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
              title: '开场',
              purpose: '留人',
              editingStyle: '强视觉/提问先出，字幕快速点题',
            },
            {
              startSec: 3,
              endSec: Math.max(10, durationSec - 6),
              title: '主体展开',
              purpose: '讲点',
              editingStyle: '信息段硬切，字幕密度随讲解升高',
            },
            {
              startSec: Math.max(10, durationSec - 6),
              endSec: durationSec,
              title: '收束',
              purpose: '收束',
              editingStyle: '结论或观察要点定格，留短暂停顿',
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
                text: sample.title.slice(0, 40) || '先抛出本片核心对象或问题',
              },
            ],
      structureBlocks,
      editingStyle: String(row.editingStyle ?? editingStyleJoined).trim() || editingStyleJoined,
      comments: parseComments(row.comments, ranked),
      takeaways: asStringArray(row.takeaways, [
        `可复用「${sample.title.slice(0, 18)}」的开场信息切入方式`,
      ]).slice(0, 5),
    })
  }

  if (drafts.length === 0) throw new Error('模型未返回可用视频拆解')
  return drafts
}

function cuesTextInRange(
  cues: Array<{ startSec: number; endSec: number; text: string }> | undefined,
  startSec: number,
  endSec: number,
): string {
  if (!cues?.length) return ''
  return cues
    .filter((cue) => cue.startSec >= startSec - 0.35 && cue.startSec < endSec)
    .map((cue) => cue.text.trim())
    .filter(Boolean)
    .join(' ')
}

function looksLikeWrongAnalysis(analysis: string, segmentText: string, title: string): boolean {
  const a = analysis.replace(/\s+/g, '')
  if (!a) return true
  if (!segmentText.trim()) return false
  // Title pasted as "analysis"
  if (title && a.includes(title.replace(/\s+/g, '').slice(0, 16))) return true
  // Almost no shared characters with the segment transcript (too generic / off-topic)
  const segChars = new Set(segmentText.replace(/\s+/g, ''))
  let hit = 0
  for (const ch of a) {
    if (segChars.has(ch)) hit += 1
  }
  return hit < Math.min(8, Math.floor(segChars.size * 0.08))
}

function heuristicAnalysis(
  block: ResearchStructureBlock,
  segmentText: string,
): string {
  const quote = segmentText.slice(0, 48).trim()
  const q = quote ? `「${quote}${segmentText.length > 48 ? '…' : ''}」` : '本段口播'
  switch (block.purpose) {
    case '留人':
    case '设问':
      return `${q}：用好奇、反差或提问先稳住停留，再引入本片要讲的对象/问题。`
    case '共鸣':
      return `${q}：对准观众已有误判或真实处境，建立认同后再给信息。`
    case '讲点':
    case '讲解':
    case '举证':
    case '示范':
      return `${q}：推进本段核心信息（特征/步骤/证据/场景），信息密度上升，少空话。`
    case '收束':
      return `${q}：汇总本片关键结论或观察要点，让观众带走可复述的知识点。`
    case '转化':
    case '互动':
      return `${q}：收束观点并引导关注/评论/收藏，把前面内容落成行动。`
    default:
      return `${q}：服务整片叙事中的「${block.purpose || block.title}」功能，推进下一信息点。`
  }
}

const BODY_TITLES = [
  '对象展开',
  '特征讲解',
  '场景说明',
  '方法拆解',
  '案例证据',
  '对比强化',
  '细节补充',
  '认知升级',
]

/** Split oversized body blocks using cue boundaries (~30s chunks). */
function splitOversizedBlocks(
  blocks: ResearchStructureBlock[],
  cues: Array<{ startSec: number; endSec: number; text: string }>,
  durationSec: number,
): ResearchStructureBlock[] {
  const maxSpan = 40
  const out: ResearchStructureBlock[] = []
  let bodyIndex = 0

  for (const block of blocks) {
    const span = block.endSec - block.startSec
    const isBody = block.purpose === '讲点' || /方法|案例|经历|证据|讲点/.test(block.title)
    if (!isBody || span <= maxSpan) {
      out.push(block)
      continue
    }

    const inRange = cues
      .filter((cue) => cue.startSec >= block.startSec - 0.05 && cue.startSec < block.endSec - 0.05)
      .sort((a, b) => a.startSec - b.startSec)

    if (inRange.length < 3) {
      out.push(block)
      continue
    }

    const parts: ResearchStructureBlock[] = []
    let partStart = block.startSec
    let lastCut = block.startSec
    for (const cue of inRange) {
      if (cue.startSec - partStart >= 24 && cue.startSec - lastCut >= 8) {
        parts.push({
          startSec: partStart,
          endSec: cue.startSec,
          title: BODY_TITLES[bodyIndex % BODY_TITLES.length]!,
          purpose: '讲点',
          editingStyle: block.editingStyle,
          analysis: block.analysis,
          keyLines: block.keyLines,
        })
        bodyIndex += 1
        partStart = cue.startSec
        lastCut = cue.startSec
      }
    }
    if (partStart < block.endSec - 1) {
      parts.push({
        startSec: partStart,
        endSec: Math.min(block.endSec, durationSec),
        title: BODY_TITLES[bodyIndex % BODY_TITLES.length]!,
        purpose: '讲点',
        editingStyle: block.editingStyle,
        analysis: block.analysis,
        keyLines: block.keyLines,
      })
      bodyIndex += 1
    }
    if (parts.length <= 1) out.push(block)
    else out.push(...parts)
  }

  return out.slice(0, 16)
}

/** Align analysis/keyLines to real cues; replace off-topic LLM fluff. */
function enrichBlocksAgainstTranscript(draft: ResearchVideoDraft): ResearchVideoDraft {
  const cues = draft.transcriptCues || []
  const durationSec = Math.max(
    draft.durationSec || 0,
    ...(draft.structureBlocks || []).map((b) => b.endSec),
    ...(cues.map((c) => c.endSec) || [0]),
  )
  const split = splitOversizedBlocks(draft.structureBlocks || [], cues, durationSec || 45)
  const blocks = split.map((block) => {
    const segmentText = cuesTextInRange(cues, block.startSec, block.endSec)
    const keyLines = (block.keyLines || []).filter((line) => {
      const compact = line.replace(/\s+/g, '')
      return compact.length > 0 && segmentText.replace(/\s+/g, '').includes(compact.slice(0, 10))
    })
    let analysis = (block.analysis || '').trim()
    if (looksLikeWrongAnalysis(analysis, segmentText, draft.title)) {
      analysis = heuristicAnalysis(block, segmentText)
    }
    const next: ResearchStructureBlock = {
      ...block,
      analysis,
    }
    if (keyLines.length > 0) next.keyLines = keyLines.slice(0, 3)
    else if (segmentText) {
      next.keyLines = segmentText
        .split(/(?<=[。！？!?])/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 6)
        .slice(0, 2)
    }
    return next
  })

  const scriptSegments = blocks.map((block, index) => {
    const existing = draft.scriptSegments?.[index]
    const segmentText = cuesTextInRange(cues, block.startSec, block.endSec)
    if (
      existing?.text?.trim() &&
      !looksLikeWrongAnalysis(existing.text, segmentText, draft.title)
    ) {
      return { ...existing, label: block.title, purpose: block.purpose }
    }
    return {
      label: block.title,
      purpose: block.purpose,
      text: block.analysis || existing?.text || '',
    }
  })

  return { ...draft, structureBlocks: blocks, scriptSegments }
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
      description: item.description.slice(0, 160),
      fullTranscript: (item.fullTranscript || '').slice(0, 8000),
      transcriptCues: (item.transcriptCues || []).slice(0, 140).map((c) => ({
        startSec: Number(c.startSec.toFixed(2)),
        endSec: Number(c.endSec.toFixed(2)),
        text: c.text.slice(0, 120),
      })),
      topComments: rankComments(item.comments)
        .slice(0, 20)
        .map((c) => ({
          author: c.author,
          content: c.content,
          diggCount: c.diggCount,
          replyCount: c.replyCount,
        })),
    }))

    const result = await llm.chat({
      temperature: 0.25,
      maxTokens: 8000,
      messages: [
        {
          role: 'system',
          content: `你是抖音短视频拆解教练。输入里的 fullTranscript / transcriptCues 是 ASR 真实口播，必须以此为唯一事实来源。

硬性要求：
1) 禁止编造、改写、润色成「假口播」。界面按时间轴展示原转写；你只做「结构切分 + 逻辑分析」。
2) 先判断内容类型，再按该类型的信息推进来切结构——禁止给所有视频套同一套营销模板。
   - 禁止默认写成：钩子→痛点→经历转折→方法拆解→CTA。
   - 科普/自然/物种类：用「开场设问、对象亮相、形态特征、习性场景、观察要点、知识收束」等贴近内容的段名。
   - 教程/步骤类：用「结果预告、问题场景、步骤1/2/3、注意点、清单收束」。
   - 人物故事类：才可用「钩子、误判/痛点、背景、转折、收获、收束」。
   - 带货/探店类：才强调卖点、对比、决策与转化。
   - title 必须概括该段在讲什么（可含物种名/步骤名），不要空泛标签。
3) structureBlocks 必须切细：
   - 60 秒以上建议 6～14 段；禁止把 1 分钟以上塞进单一段。
   - 单段通常 6～35 秒；startSec/endSec 对齐 transcriptCues，覆盖 0→durationSec，段间衔接、少重叠。
4) purpose 用短标签描述段落功能，可按内容自选：留人|设问|讲点|讲解|举证|示范|共鸣|收束|互动|转化|过渡；不要硬塞「痛点」。
5) 每段 analysis 紧扣该段原转写：信息推进、讲解策略、为何这样讲；引用本段原意，禁止空话套话。
6) keyLines：从该时段原转写摘 1～3 句原话短句（须能在 cues 中找到近似原文）。
7) editingStyle：按口播停顿与信息密度推断字幕/切点/镜头，写可观察点。
8) scriptSegments 与 structureBlocks 一一对应，text 写本段策略总结（非台词复述）。
9) summary：一句话概括「讲了什么 + 结构策略」，必须从转写推出。
10) videoType 在 口播|带货|探店|教程|剧情|资讯|科普|其他 中选最贴切的一个。
11) comments 可省略；不要编造互动数据。

只输出 JSON，不要 markdown：
{
  "videos": [{
    "awemeId":"必须与输入一致",
    "title":"可微调标题",
    "videoType":"口播|带货|探店|教程|剧情|资讯|科普|其他",
    "matchScore":1-100,
    "summary":"基于原转写的一句话摘要",
    "scriptSegments":[{"label":"段名","purpose":"留人|设问|讲点|讲解|举证|示范|共鸣|收束|互动|转化","text":"本段策略总结"}],
    "structureBlocks":[{
      "startSec":0,"endSec":8,"title":"贴合内容的段名","purpose":"设问",
      "editingStyle":"具体剪辑/字幕推断",
      "analysis":"该段逻辑与作用（基于原文）",
      "keyLines":["原话短句"]
    }],
    "takeaways":["创作者可复用的结构/讲解要点"]
  }]
}
若 fullTranscript 为空，summary 写明「无可用转写」，structureBlocks 仅按时长粗切并在 analysis 说明依据不足。`,
        },
        {
          role: 'user',
          content: `选题：${topic.title}\n选题说明：${topic.summary || topic.reason}\n请先判断内容类型，再按该类型做细致结构拆解（不要套万能营销模板；不要编台词；长视频必须切细）：\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
    })

    const drafts = parseDrafts(extractJsonValue(result.content), samples).map((draft, index) => {
      const sample = samples[index]
      const withTranscript = {
        ...draft,
        fullTranscript: sample?.fullTranscript || draft.fullTranscript || '',
        transcriptCues: sample?.transcriptCues || draft.transcriptCues || [],
      }
      return enrichBlocksAgainstTranscript(withTranscript)
    })

    return {
      drafts,
      source: 'llm',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '大模型拆解失败'
    return {
      drafts: buildRuleResearchFromSamples(topic, samples).map((draft, index) =>
        enrichBlocksAgainstTranscript({
          ...draft,
          fullTranscript: samples[index]?.fullTranscript || '',
          transcriptCues: samples[index]?.transcriptCues || [],
          summary: samples[index]?.fullTranscript
            ? draft.summary
            : `拆解失败：${message}`,
        }),
      ),
      source: 'fallback',
      note: message,
    }
  }
}
