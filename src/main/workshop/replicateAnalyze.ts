import { asRecord, asStringArray, extractJsonValue } from '../llm/json'
import type { LlmService } from '../llm/service'
import type { ResearchVideoDetail } from '../../shared/research'
import type { WorkshopScriptSegment } from '../../shared/workshop'
import { buildFullScriptText } from '../../shared/workshop'

export interface WorkshopReplicateDraft {
  title: string
  angle: string
  summary: string
  durationHintSec: number
  videoType: string
  segments: WorkshopScriptSegment[]
  hooks: string[]
  ctaOptions: string[]
  commentInsights: string[]
  fullScriptText: string
}

function parseSegments(raw: unknown, fallback: WorkshopScriptSegment[]): WorkshopScriptSegment[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback
  return raw
    .map((item, index) => {
      const row = asRecord(item)
      if (!row) return null
      const spokenText = String(row.spokenText ?? row.text ?? '').trim()
      if (!spokenText) return null
      return {
        order: typeof row.order === 'number' ? row.order : index,
        title: String(row.title ?? fallback[index]?.title ?? `段落${String(index + 1)}`).trim(),
        purpose: String(row.purpose ?? fallback[index]?.purpose ?? '讲点').trim(),
        beatSec: Math.max(0, Number(row.beatSec ?? fallback[index]?.beatSec ?? 8) || 8),
        spokenText,
        why: String(row.why ?? fallback[index]?.why ?? '').trim(),
        editHint: String(row.editHint ?? fallback[index]?.editHint ?? '').trim(),
        sourceKeyLines: asStringArray(row.sourceKeyLines).slice(0, 3),
      } satisfies WorkshopScriptSegment
    })
    .filter((item): item is WorkshopScriptSegment => Boolean(item))
}

function ruleFallback(detail: ResearchVideoDetail): WorkshopReplicateDraft {
  const blocks = detail.structureBlocks.length > 0 ? detail.structureBlocks : [
    { startSec: 0, endSec: 4, title: '开场', purpose: '留人', editingStyle: '', analysis: '', keyLines: [] },
    { startSec: 4, endSec: 14, title: '展开', purpose: '讲点', editingStyle: '', analysis: '', keyLines: [] },
    { startSec: 14, endSec: Math.max(20, detail.durationSec - 6), title: '讲解', purpose: '讲解', editingStyle: '', analysis: '', keyLines: [] },
    { startSec: Math.max(20, detail.durationSec - 6), endSec: detail.durationSec || 30, title: '收束', purpose: '收束', editingStyle: '', analysis: '', keyLines: [] },
  ]

  const segments: WorkshopScriptSegment[] = blocks.map((block, index) => {
    const beatSec = Math.max(3, Math.round(block.endSec - block.startSec))
    const keys = (block.keyLines ?? []).slice(0, 2)
    const cueText = (detail.transcriptCues ?? [])
      .filter((cue) => cue.startSec >= block.startSec - 0.05 && cue.startSec < block.endSec)
      .map((cue) => cue.text.trim())
      .filter(Boolean)
      .join(' ')
    const seed = keys[0] || cueText.slice(0, 36) || block.title
    let spoken = ''
    switch (block.purpose) {
      case '留人':
      case '设问':
        spoken = `先问一句：关于「${seed || detail.topicTitle || '这个话题'}」，你有没有想错过答案？往下看就懂。`
        break
      case '共鸣':
        spoken = `你可能也碰到过类似情况：看着热闹，却抓不住重点。这很正常。`
        break
      case '讲点':
      case '讲解':
      case '示范':
      case '举证':
        spoken = `这一段把「${seed}」讲清楚：抓住一个关键点，讲透就够，别贪多。`
        break
      case '收束':
        spoken = `记住这一条就行：${seed || '把今天的核心结论带走'}。下期继续拆更细。`
        break
      case '转化':
      case '互动':
        spoken = `如果你也在关注这个方向，评论区告诉我你卡在哪一步；关注我，下期继续拆。`
        break
      default:
        spoken = `这一段重点讲清楚：${seed}。别求一次讲完，讲透一个点就够。`
    }
    return {
      order: index,
      title: block.title,
      purpose: block.purpose,
      beatSec,
      spokenText: spoken,
      why: (block.analysis || '').trim() || `服务整片「${block.purpose}」功能，把信息推进一步。`,
      editHint: block.editingStyle || '口播近景 + 关键词字幕',
      sourceKeyLines: keys,
    }
  })

  const insights = detail.comments
    .slice(0, 5)
    .map((item) => item.content.trim())
    .filter((text) => text.length >= 4)
    .slice(0, 4)

  return {
    title: `复刻｜${detail.title.slice(0, 28)}`,
    angle: `借鉴「${detail.videoType}」叙事节奏，换成可执行口播`,
    summary: detail.summary || `按原片结构仿写一版可拍口播，服务选题「${detail.topicTitle}」。`,
    durationHintSec: detail.durationSec || segments.reduce((sum, seg) => sum + seg.beatSec, 0),
    videoType: detail.videoType,
    segments,
    hooks: [segments[0]?.spokenText || '先抛反差，再给路径。'],
    ctaOptions: [segments.at(-1)?.spokenText || '评论区告诉我你卡在哪一步。'],
    commentInsights: insights,
    fullScriptText: buildFullScriptText(segments),
  }
}

export async function replicateScriptWithLlm(
  llm: LlmService,
  detail: ResearchVideoDetail,
): Promise<{ draft: WorkshopReplicateDraft; source: 'llm' | 'fallback'; note?: string }> {
  const fallback = ruleFallback(detail)
  try {
    const payload = {
      topicTitle: detail.topicTitle,
      videoType: detail.videoType,
      title: detail.title,
      durationSec: detail.durationSec,
      summary: detail.summary,
      takeaways: detail.takeaways.slice(0, 6),
      structureBlocks: detail.structureBlocks.map((block) => ({
        title: block.title,
        purpose: block.purpose,
        startSec: block.startSec,
        endSec: block.endSec,
        analysis: block.analysis ?? '',
        editingStyle: block.editingStyle,
        keyLines: (block.keyLines ?? []).slice(0, 3),
      })),
      transcriptExcerpt: (detail.fullTranscript || '').slice(0, 2500),
      topComments: detail.comments.slice(0, 12).map((item) => ({
        content: item.content,
        diggCount: item.diggCount,
        replyCount: item.replyCount,
      })),
    }

    const result = await llm.chat({
      temperature: 0.55,
      maxTokens: 5000,
      messages: [
        {
          role: 'system',
          content: `你是短视频口播脚本编剧。任务：根据样本拆解「模仿思路」写一版全新可拍口播，不是翻译原文。

硬性要求：
1) 模仿的是样本真实叙事功能与信息推进，不是复述原台词；不要强行改成「痛点→转折→CTA」营销模板。
2) 若样本是科普/教程/人物故事等，段名与 purpose 要贴合该类型（如设问、对象亮相、特征讲解、步骤、收束）。
3) spokenText 必须是能直接念的口语短句；禁止大段照抄 transcriptExcerpt / keyLines。
4) 段数建议 4～10：可合并过碎原段，也可按信息点拆细；每段 purpose 清楚。
5) why 写清该段策略；editHint 给具体画面/字幕建议；sourceKeyLines 仅作对照。
6) hooks / ctaOptions 各给 2～3 个可替换版本；commentInsights 从评论提炼诉求。
7) 整体服务选题 topicTitle，语气像真人博主，不要广告腔。

只输出 JSON：
{
  "title":"脚本标题",
  "angle":"一句话切入角",
  "summary":"整片策略摘要",
  "durationHintSec":45,
  "videoType":"口播|教程|科普|其他",
  "segments":[{
    "order":0,"title":"贴合内容的段名","purpose":"设问|讲点|讲解|收束|留人","beatSec":5,
    "spokenText":"口播正文",
    "why":"策略",
    "editHint":"剪辑提示",
    "sourceKeyLines":["原意对照"]
  }],
  "hooks":["开场备选"],
  "ctaOptions":["结尾备选"],
  "commentInsights":["评论洞察"]
}`,
        },
        {
          role: 'user',
          content: `请基于以下拆解结果做「思路仿写」口播脚本：\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
    })

    const root = asRecord(extractJsonValue(result.content)) ?? {}
    const segments = parseSegments(root.segments, fallback.segments)
    const draft: WorkshopReplicateDraft = {
      title: String(root.title ?? fallback.title).trim() || fallback.title,
      angle: String(root.angle ?? fallback.angle).trim() || fallback.angle,
      summary: String(root.summary ?? fallback.summary).trim() || fallback.summary,
      durationHintSec:
        Number(root.durationHintSec ?? fallback.durationHintSec) || fallback.durationHintSec,
      videoType: String(root.videoType ?? fallback.videoType).trim() || fallback.videoType,
      segments,
      hooks: asStringArray(root.hooks).slice(0, 4).length
        ? asStringArray(root.hooks).slice(0, 4)
        : fallback.hooks,
      ctaOptions: asStringArray(root.ctaOptions).slice(0, 4).length
        ? asStringArray(root.ctaOptions).slice(0, 4)
        : fallback.ctaOptions,
      commentInsights: asStringArray(root.commentInsights).slice(0, 6).length
        ? asStringArray(root.commentInsights).slice(0, 6)
        : fallback.commentInsights,
      fullScriptText: buildFullScriptText(segments),
    }
    return { draft, source: 'llm' }
  } catch (error) {
    const message = error instanceof Error ? error.message : '复刻失败'
    return { draft: fallback, source: 'fallback', note: message }
  }
}