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
  {
    type: '科普',
    words: [
      '科普',
      '昆虫',
      '动物',
      '植物',
      '物种',
      '甲虫',
      '科学',
      '实验',
      '习性',
      '特征',
      '自然',
      '知识',
      '观察',
    ],
  },
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
  const open =
    parts[0] ||
    title ||
    (videoType === '科普'
      ? `先抛出关于「${topic}」的好奇问题或反差画面。`
      : `先点明「${topic}」要解决什么。`)
  const body =
    parts[1] ||
    parts[0] ||
    (videoType === '科普'
      ? `围绕对象特征、习性或观察要点展开讲解。`
      : `围绕「${topic}」给出可执行信息，少讲空概念。`)
  const close =
    parts[2] ||
    (videoType === '带货'
      ? '收尾给出决策建议，并引导评论区提问。'
      : videoType === '科普'
        ? '收束关键知识点，留下可复述的结论或观察提示。'
        : '收尾抛问题，引导评论留下卡点，方便做下期。')

  const midLabel =
    videoType === '科普'
      ? '特征/习性'
      : videoType === '教程'
        ? '步骤展开'
        : '主体展开'

  return [
    {
      label: videoType === '科普' ? '开场设问' : '开头钩子',
      purpose: videoType === '科普' ? '设问' : '留人',
      text: open.slice(0, 80),
    },
    {
      label: midLabel,
      purpose: '讲点',
      text: body.slice(0, 100),
    },
    {
      label: videoType === '科普' ? '观察要点' : '补充证据',
      purpose: videoType === '科普' ? '讲解' : '举证',
      text:
        parts[3]?.slice(0, 90) ||
        (videoType === '科普'
          ? `补充可观察细节，帮助观众记住「${topic}」相关知识点。`
          : `用具体场景说明「${topic}」为何成立。`),
    },
    {
      label: videoType === '带货' ? '转化收束' : '知识收束',
      purpose: videoType === '带货' ? '转化' : '收束',
      text: close.slice(0, 80),
    },
  ]
}

function segmentEditingStyle(videoType: ResearchVideoType, title: string): string {
  const byType: Record<string, Record<string, string>> = {
    科普: {
      开场设问: '特写/夜拍抢眼画面先出，提问字幕上屏',
      对象亮相: '主体全景→特写，字幕点物种名',
      形态特征: '部位特写慢推，关键词角标逐条出',
      习性场景: '行为过程跟拍，字幕补习性说明',
      观察要点: '对比镜头或细节定格，清单式字幕',
      知识收束: '结论大字定格，留 1 秒方便截图',
    },
    口播: {
      钩子: '近景口播急推，关键词大字闪入',
      身份铺垫: '口播特写稳住，字幕补背景信息',
      方法拆解: '口播 + 示意图/屏幕录制交替，字幕密度升高',
      收束: '镜头拉近，提问或结论字幕置底',
    },
    教程: {
      结果预告: '结果画面先闪，再切讲师近景',
      问题场景: '失败/卡点快切，红叉或提示角标',
      步骤展开: '步骤分镜 + 数字角标，每步硬切',
      清单收束: '清单大字报定格，口播引导收藏',
    },
    探店: {
      门头亮相: '门头/环境 sweep，字幕甩店名',
      体验过程: '跟拍点单/试吃，节奏偏快',
      卖点特写: '商品特写 + 价格字幕贴边',
      到店引导: '地址/导航字幕定格',
    },
    带货: {
      痛点开场: '痛点反问上屏，商品闪现',
      卖点对比: '前后对比镜头，卖点字幕贴边',
      使用演示: '功能特写 + 使用演示',
      转化收束: '价格/链接口播，库存或倒计时字幕',
    },
    资讯: {
      结论先行: '结论大字先出，背景画面虚化',
      要点展开: '要点卡片翻页，旁白短句',
      数据举证: '数据图/截图快切，字幕强调数字',
      收束预告: '下期预告角标，引导关注',
    },
    剧情: {
      冲突开场: '冲突动作前置，音乐起拍同步',
      人物推进: '表情特写，环境光对比',
      反转高潮: '反转切镜，节奏突变',
      讨论收束: '定格表情，字幕抛讨论问题',
    },
    其他: {
      开场: '强视觉开场，字幕快速点题',
      展开: '中景叙事，字幕补信息',
      收束: '结论或提问定格',
    },
  }
  const table = byType[videoType] ?? byType['其他']!
  if (table[title]) return table[title]!
  const fallbackKey = Object.keys(table).find((key) => title.includes(key.slice(0, 2)))
  if (fallbackKey) return table[fallbackKey]!
  return Object.values(table)[1] || '按段落信息密度匹配切点与字幕'
}

type StructurePlanItem = { title: string; purpose: string; weight: number }

function structurePlanForType(videoType: ResearchVideoType): StructurePlanItem[] {
  switch (videoType) {
    case '科普':
      return [
        { title: '开场设问', purpose: '设问', weight: 0.1 },
        { title: '对象亮相', purpose: '讲点', weight: 0.14 },
        { title: '形态特征', purpose: '讲解', weight: 0.22 },
        { title: '习性场景', purpose: '讲解', weight: 0.22 },
        { title: '观察要点', purpose: '举证', weight: 0.18 },
        { title: '知识收束', purpose: '收束', weight: 0.14 },
      ]
    case '教程':
      return [
        { title: '结果预告', purpose: '留人', weight: 0.1 },
        { title: '问题场景', purpose: '设问', weight: 0.14 },
        { title: '步骤展开', purpose: '示范', weight: 0.46 },
        { title: '注意点', purpose: '讲解', weight: 0.16 },
        { title: '清单收束', purpose: '收束', weight: 0.14 },
      ]
    case '带货':
      return [
        { title: '痛点开场', purpose: '留人', weight: 0.1 },
        { title: '卖点对比', purpose: '共鸣', weight: 0.18 },
        { title: '使用演示', purpose: '示范', weight: 0.42 },
        { title: '转化收束', purpose: '转化', weight: 0.3 },
      ]
    case '探店':
      return [
        { title: '门头亮相', purpose: '留人', weight: 0.12 },
        { title: '体验过程', purpose: '讲点', weight: 0.4 },
        { title: '卖点特写', purpose: '举证', weight: 0.3 },
        { title: '到店引导', purpose: '转化', weight: 0.18 },
      ]
    case '资讯':
      return [
        { title: '结论先行', purpose: '留人', weight: 0.12 },
        { title: '要点展开', purpose: '讲点', weight: 0.4 },
        { title: '数据举证', purpose: '举证', weight: 0.3 },
        { title: '收束预告', purpose: '收束', weight: 0.18 },
      ]
    case '剧情':
      return [
        { title: '冲突开场', purpose: '留人', weight: 0.12 },
        { title: '人物推进', purpose: '讲点', weight: 0.38 },
        { title: '反转高潮', purpose: '讲点', weight: 0.32 },
        { title: '讨论收束', purpose: '互动', weight: 0.18 },
      ]
    case '口播':
    default:
      return [
        { title: '钩子', purpose: '留人', weight: 0.1 },
        { title: '身份铺垫', purpose: '讲点', weight: 0.16 },
        { title: '方法拆解', purpose: '讲点', weight: 0.42 },
        { title: '案例补充', purpose: '举证', weight: 0.18 },
        { title: '收束', purpose: '收束', weight: 0.14 },
      ]
  }
}

function buildStructure(
  durationSec: number,
  videoType: ResearchVideoType,
): ResearchStructureBlock[] {
  const duration = Math.max(18, durationSec)
  const plan = structurePlanForType(videoType)
  const totalWeight = plan.reduce((sum, item) => sum + item.weight, 0) || 1
  const raw: Array<{ startSec: number; endSec: number; title: string; purpose: string }> = []
  let cursor = 0

  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i]!
    const span = Math.max(
      3,
      Math.round((duration * item.weight) / totalWeight),
    )
    const start = cursor
    const end = i === plan.length - 1 ? duration : Math.min(duration, start + span)
    if (end <= start) continue
    raw.push({
      startSec: start,
      endSec: end,
      title: item.title,
      purpose: item.purpose,
    })
    cursor = end
  }

  // 过长主体段再切细，标题沿用类型计划中的讲解类名称
  const refined: typeof raw = []
  const bodyTitles = plan
    .filter((item) => ['讲点', '讲解', '示范', '举证'].includes(item.purpose))
    .map((item) => item.title)
  let bodyIndex = 0
  for (const block of raw) {
    const span = block.endSec - block.startSec
    const isBody = ['讲点', '讲解', '示范', '举证'].includes(block.purpose)
    if (!isBody || span <= 36) {
      refined.push(block)
      continue
    }
    const parts = Math.max(2, Math.min(4, Math.round(span / 28)))
    for (let i = 0; i < parts; i += 1) {
      const start = Math.round(block.startSec + (span * i) / parts)
      const end =
        i === parts - 1
          ? block.endSec
          : Math.round(block.startSec + (span * (i + 1)) / parts)
      refined.push({
        startSec: start,
        endSec: end,
        title:
          parts === 1
            ? block.title
            : bodyTitles[bodyIndex % Math.max(1, bodyTitles.length)] ||
              `${block.title}${String(i + 1)}`,
        purpose: block.purpose,
      })
      bodyIndex += 1
    }
  }

  return refined.map((block) => ({
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
    videoType === '科普'
      ? `开头尽快点名具体对象/现象（相对「${topic}」大类更可检索），再用设问或反差留人。`
      : `开头尽快点名「${topic}」，比宽泛大类更容易被检索与停留。`,
    `${structure[0]!.title}控制在前 ${String(structure[0]!.endSec)} 秒，先立住观看动机再展开。`,
    askCount >= 2
      ? '评论区高频求方法/清单，可做成固定栏目回应。'
      : top
        ? `高互动评论方向：${top.content.slice(0, 28)}${top.content.length > 28 ? '…' : ''}`
        : '评论样本不足，下轮可加强结尾提问引导。',
    `保持「${videoType}」类型辨识度，段名与讲解节奏贴合内容，避免套无关营销模板。`,
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
    comments: rankComments(sample.comments).slice(0, 120),
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
      summary: sample.fullTranscript
        ? `已转写约 ${String(sample.fullTranscript.length)} 字；类型偏${scored.videoType}，匹配 ${String(scored.matchScore)}。`
        : `「${topic.title}」样本：类型偏${scored.videoType}，匹配 ${String(scored.matchScore)}，适合学习开头与中段信息密度。`,
      editingStyle: editingStyleOf(scored.videoType, structureBlocks),
      scriptSegments,
      structureBlocks,
      comments: scored.comments,
      takeaways: takeawaysOf(topic.title, scored.videoType, scored.comments, structureBlocks),
      fullTranscript: sample.fullTranscript || '',
      transcriptCues: sample.transcriptCues || [],
    }
  })
}
