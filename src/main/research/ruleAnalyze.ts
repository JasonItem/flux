import type {
  ResearchCommentItem,
  ResearchScriptSegment,
  ResearchStructureBlock,
  ResearchVideoType,
} from '../../shared/research'
import type { TopicItem } from '../../shared/topic'
import type { ResearchVideoDraft } from './mockAnalyze'
import type { ResearchSampleInput } from './sampleTypes'

const TYPE_RULES: Array<{ type: ResearchVideoType; words: string[] }> = [
  { type: '带货', words: ['购买', '链接', '下单', '优惠', '种草', '测评推荐', '便宜'] },
  { type: '探店', words: ['探店', '打卡', '同城', '门口', '人均', '地址'] },
  { type: '教程', words: ['教程', '步骤', '怎么', '方法', '教你', '清单', '公式'] },
  { type: '口播', words: ['我说', '分享', '告诉你', '注意', '干货', '避坑'] },
  { type: '资讯', words: ['最新', '政策', '趋势', '解读', '刚出', '变化'] },
  { type: '剧情', words: ['反转', '故事', '竟然', '没想到', '结局'] },
]

function clampScore(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)))
}

function normalize(text: string): string {
  return text.toLowerCase()
}

function classifyType(text: string): ResearchVideoType {
  const normalized = normalize(text)
  let best: { type: ResearchVideoType; hits: number } | null = null
  for (const rule of TYPE_RULES) {
    const hits = rule.words.filter((word) => normalized.includes(word)).length
    if (hits <= 0) continue
    if (!best || hits > best.hits) best = { type: rule.type, hits }
  }
  return best?.type ?? '口播'
}

function topicOverlapScore(topic: string, text: string): number {
  const topicChars = [...topic].filter((ch) => ch.trim())
  if (topicChars.length === 0) return 50
  const normalized = normalize(text)
  const hit = topicChars.filter((ch) => normalized.includes(ch.toLowerCase())).length
  return clampScore((hit / topicChars.length) * 100)
}

function rankComments(comments: ResearchCommentItem[]): ResearchCommentItem[] {
  const score = (item: ResearchCommentItem): ResearchCommentItem => {
    const intentBoost =
      /求|怎么|哪里|链接|清单|对比|同款|谢谢|学到/.test(item.content) ? 12 : 0
    return {
      ...item,
      qualityScore: clampScore(
        item.diggCount * 0.05 + item.replyCount * 1.9 + item.replyRate * 35 + intentBoost,
      ),
      replies: (item.replies ?? []).map(score),
    }
  }
  return [...comments].map(score).sort((a, b) => b.qualityScore - a.qualityScore)
}

function splitDescription(description: string): string[] {
  return description
    .split(/[\n。！？!?；;]+/)
    .map((item) => item.replace(/[#＃]\S+/g, '').trim())
    .filter((item) => item.length >= 4)
}

function buildScriptSegments(
  topic: string,
  title: string,
  description: string,
  videoType: ResearchVideoType,
): ResearchScriptSegment[] {
  const parts = splitDescription(description)
  const hook = parts[0] || title || `先把「${topic}」的痛点说透`
  const body =
    parts[1] ||
    parts[0] ||
    `围绕「${topic}」给出可执行步骤，少讲概念多讲动作。`
  const close =
    parts[2] ||
    (videoType === '带货'
      ? '收尾给出决策建议，并引导评论区提问。'
      : '收尾抛问题，引导评论留下卡点，方便做下期。')

  return [
    {
      label: '开头钩子',
      purpose: '留人',
      text: hook.slice(0, 80),
    },
    {
      label: videoType === '教程' || videoType === '口播' ? '方法拆解' : '主体展开',
      purpose: '讲点',
      text: body.slice(0, 100),
    },
    {
      label: '共鸣/证据',
      purpose: '共鸣',
      text:
        parts[3]?.slice(0, 90) ||
        `用具体场景说明「${topic}」为什么值得现在做，而不是空讲趋势。`,
    },
    {
      label: '收束 CTA',
      purpose: '互动转化',
      text: close.slice(0, 80),
    },
  ]
}

function segmentEditingStyle(videoType: ResearchVideoType, title: string): string {
  const byType: Record<string, Record<string, string>> = {
    口播: {
      钩子: '近景口播急推，关键词大字闪入，切点落在痛点词上',
      痛点: '口播特写稳住，字幕逐条点出场景，少转场',
      '方法/案例': '口播 + 屏幕录制/示意图交替，字幕密度升高',
      CTA: '镜头拉近，字幕提问置底，留 1 秒停顿方便截图',
    },
    教程: {
      钩子: '结果画面先闪，再切讲师近景，字幕点题',
      痛点: '失败案例快切对比，红叉/黄标提示',
      '方法/案例': '步骤分镜 + 数字角标，每步硬切不叠化',
      CTA: '清单大字报定格，口播引导评论区领取',
    },
    探店: {
      钩子: '门头/环境 sweep，字幕甩出店名与定位',
      痛点: '跟拍顾客犹豫点，插入价格/排队字幕',
      '方法/案例': '商品特写 + 现场试吃/试用，节奏偏快',
      CTA: '地址/导航字幕定格，口播引导收藏',
    },
    带货: {
      钩子: '痛点反问上屏，商品闪现 0.5 秒',
      痛点: '前后对比镜头，卖点字幕贴边',
      '方法/案例': '功能特写 + 使用演示，切点对齐卖点',
      CTA: '价格/链接口播，倒计时或库存字幕',
    },
    资讯: {
      钩子: '结论大字先出，背景新闻画面虚化',
      痛点: '要点卡片翻页，旁白短句',
      '方法/案例': '数据图/截图快切，字幕强调数字',
      CTA: '下期预告角标，引导关注',
    },
    剧情: {
      钩子: '冲突动作前置，音乐起拍同步',
      痛点: '人物表情特写，压暗环境光',
      '方法/案例': '反转切镜 + 回忆闪回，节奏突变',
      CTA: '定格表情，字幕抛讨论问题',
    },
    其他: {
      钩子: '强视觉开场，字幕快速点题',
      痛点: '中景叙事，字幕补场景',
      '方法/案例': '混剪/示意图穿插，结论先行',
      CTA: '清单或提问定格收束',
    },
  }
  const table = byType[videoType] ?? byType['其他']!
  return table[title] ?? table['方法/案例'] ?? '按段落目的匹配切点与字幕密度'
}

function buildStructure(
  durationSec: number,
  videoType: ResearchVideoType,
): ResearchStructureBlock[] {
  const duration = Math.max(18, durationSec)
  const hookEnd = Math.min(4, Math.max(2, Math.round(duration * 0.08)))
  const painEnd = Math.min(hookEnd + 10, Math.round(duration * 0.28))
  const bodyEnd = Math.max(painEnd + 6, duration - 7)
  const blocks = [
    { startSec: 0, endSec: hookEnd, title: '钩子', purpose: '留人' },
    { startSec: hookEnd, endSec: painEnd, title: '痛点', purpose: '共鸣' },
    { startSec: painEnd, endSec: bodyEnd, title: '方法/案例', purpose: '讲点' },
    { startSec: bodyEnd, endSec: duration, title: 'CTA', purpose: '互动转化' },
  ]
  return blocks.map((block) => ({
    ...block,
    editingStyle: segmentEditingStyle(videoType, block.title),
  }))
}

function editingStyleOf(videoType: ResearchVideoType, blocks: ResearchStructureBlock[]): string {
  return blocks.map((block) => `${block.title}：${block.editingStyle}`).join('；') || segmentEditingStyle(videoType, '方法/案例')
}

function takeawaysOf(
  topic: string,
  videoType: ResearchVideoType,
  comments: ResearchCommentItem[],
  structure: ResearchStructureBlock[],
): string[] {
  const top = comments[0]
  const askCount = comments.filter((item) => /求|怎么|哪里|链接|清单/.test(item.content)).length
  return [
    `开头尽快点名「${topic}」，比宽泛大类更容易被检索与停留。`,
    `${structure[0]!.title}仅控制在前 ${String(structure[0]!.endSec)} 秒，先留人再讲点。`,
    askCount >= 2
      ? '评论区高频求方法/清单，可做成固定栏目回应。'
      : top
        ? `高互动评论方向：${top.content.slice(0, 28)}${top.content.length > 28 ? '…' : ''}`
        : '评论样本不足，下轮可加强结尾提问引导。',
    `保持「${videoType}」单一类型辨识度，避免同片多人设。`,
  ]
}

function scoreSample(
  topic: TopicItem,
  sample: ResearchSampleInput,
  index: number,
): { videoType: ResearchVideoType; matchScore: number; comments: ResearchCommentItem[] } {
  const corpus = `${sample.title}\n${sample.description}`
  const videoType = classifyType(corpus)
  const overlap = topicOverlapScore(topic.title, corpus)
  const engagement = clampScore(
    Math.log10(1 + sample.diggCount + sample.commentCount * 2) * 16,
  )
  const matchScore = clampScore(
    overlap * 0.62 + engagement * 0.28 + (sample.matchHint ?? 70) * 0.1 - index,
  )
  return {
    videoType,
    matchScore,
    comments: rankComments(sample.comments).slice(0, 10),
  }
}

/** 列表阶段：只落样本元数据，不写文案/结构拆解 */
export function buildPendingResearchFromSamples(
  topic: TopicItem,
  samples: ResearchSampleInput[],
): ResearchVideoDraft[] {
  return samples.map((sample, index) => {
    const scored = scoreSample(topic, sample, index)
    return {
      awemeId: sample.awemeId,
      coverUrl: sample.coverUrl,
      playUrl: sample.playUrl,
      title: sample.title,
      authorNickname: sample.authorNickname,
      authorUniqueId: sample.authorUniqueId,
      diggCount: sample.diggCount,
      commentCount: sample.commentCount,
      shareCount: sample.shareCount,
      durationSec: sample.durationSec || 45,
      videoType: scored.videoType,
      matchScore: scored.matchScore,
      profileUrl: sample.profileUrl,
      description: sample.description || sample.title,
      summary: '',
      editingStyle: '',
      scriptSegments: [],
      structureBlocks: [],
      comments: scored.comments,
      takeaways: [],
    }
  })
}

/** 基于真实样本的本地规则拆解（不依赖大模型） */
export function buildRuleResearchFromSamples(
  topic: TopicItem,
  samples: ResearchSampleInput[],
): ResearchVideoDraft[] {
  return samples.map((sample, index) => {
    const scored = scoreSample(topic, sample, index)
    const durationSec = sample.durationSec || 45
    const structureBlocks = buildStructure(durationSec, scored.videoType)
    const scriptSegments = buildScriptSegments(
      topic.title,
      sample.title,
      sample.description,
      scored.videoType,
    )

    return {
      awemeId: sample.awemeId,
      coverUrl: sample.coverUrl,
      playUrl: sample.playUrl,
      title: sample.title,
      authorNickname: sample.authorNickname,
      authorUniqueId: sample.authorUniqueId,
      diggCount: sample.diggCount,
      commentCount: sample.commentCount,
      shareCount: sample.shareCount,
      durationSec,
      videoType: scored.videoType,
      matchScore: scored.matchScore,
      profileUrl: sample.profileUrl,
      description: sample.description || sample.title,
      summary: `「${topic.title}」样本：类型偏${scored.videoType}，匹配 ${String(scored.matchScore)}，适合学习开头与中段信息密度。`,
      editingStyle: editingStyleOf(scored.videoType, structureBlocks),
      scriptSegments,
      structureBlocks,
      comments: scored.comments,
      takeaways: takeawaysOf(topic.title, scored.videoType, scored.comments, structureBlocks),
    }
  })
}
