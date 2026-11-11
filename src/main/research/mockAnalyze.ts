import type { TopicItem } from '../../shared/topic'
import type {
  ResearchCommentItem,
  ResearchScriptSegment,
  ResearchStructureBlock,
  ResearchVideoType,
} from '../../shared/research'

export interface ResearchVideoDraft {
  awemeId?: string | null
  coverUrl?: string | null
  playUrl?: string | null
  title: string
  authorNickname: string
  authorUniqueId: string | null
  diggCount: number
  commentCount: number
  shareCount: number
  durationSec: number
  videoType: ResearchVideoType
  matchScore: number
  profileUrl: string
  /** 原始描述，供首次点详情时拆解；列表阶段可为空拆解字段 */
  description?: string
  summary: string
  editingStyle: string
  scriptSegments: ResearchScriptSegment[]
  structureBlocks: ResearchStructureBlock[]
  comments: ResearchCommentItem[]
  takeaways: string[]
}

/** 列表阶段样本：只保留元数据与评论，文案/结构等留到点进详情再拆 */
export function toPendingDraft(draft: ResearchVideoDraft): ResearchVideoDraft {
  return {
    ...draft,
    description: draft.description ?? draft.title,
    summary: '',
    editingStyle: '',
    scriptSegments: [],
    structureBlocks: [],
    takeaways: [],
  }
}

const TYPE_CYCLE: ResearchVideoType[] = ['口播', '教程', '资讯', '带货', '探店', '剧情']

/** 用户提供的可播直链（CDN 可能过期，过期后需换新） */
const MOCK_PLAY_URL =
  'https://v5-dy-ov-experiment.zjcdn.com/4182dd1b00551aea5d4af217fa9836a6/6af2ebf4/video/tos/cn/tos-cn-ve-15/ogACQ8LKXlGHQ8jbBgGAIm2e76VAUCHBR0I1ee/?a=6383&ch=26&cr=3&dr=0&lr=all&cd=0%7C0%7C0%7C3&cv=1&br=541&bt=541&cs=0&ds=3&ft=CZdgCYlIDyjNNRVQ9wIG9HHhd.l656P73-ApQX&mime_type=video_mp4&qs=0&rc=Ojw6OzxnODs8NjRmNWhmZEBpM3hkbnk5cmp0ZTMzNGkzM0AtNmBjX2MyNV8xLy0tMjI0YSNjL2tiMmRzNmphLS1kLTBzcw%3D%3D&btag=c0000e00028000&cquery=100w_100B_100H_100K_100o&dy_q=1794294081&feature_id=f5241e7604dff1d9d6c943fd20bd51a2&l=20261110150121C8DA7D4EAEA41599AC78'

const MOCK_MEDIA = [
  { durationSec: 30, label: '样1', tone: '#3d5a80' },
  { durationSec: 30, label: '样2', tone: '#ee6c4d' },
  { durationSec: 30, label: '样3', tone: '#293241' },
] as const

function mockCoverDataUrl(label: string, tone: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="270" height="480" viewBox="0 0 270 480">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${tone}"/><stop offset="100%" stop-color="#111"/>
  </linearGradient></defs>
  <rect width="270" height="480" fill="url(#g)"/>
  <circle cx="135" cy="220" r="36" fill="rgba(255,255,255,0.22)"/>
  <polygon points="128,204 128,236 152,220" fill="#fff"/>
  <text x="135" y="300" fill="#fff" font-size="28" text-anchor="middle" font-family="sans-serif">${label}</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function hashSeed(input: string): number {
  let value = 0
  for (let i = 0; i < input.length; i += 1) {
    value = (value * 31 + input.charCodeAt(i)) >>> 0
  }
  return value || 1
}

function pick<T>(items: T[], seed: number, index: number): T {
  return items[(seed + index) % items.length]!
}

function mockCommentAvatar(author: string, toneIndex: number): string {
  const tones = ['#3d5a80', '#ee6c4d', '#98c1d9', '#293241', '#e0fbfc', '#8b5cf6']
  const tone = tones[toneIndex % tones.length]!
  const initial = author.slice(-2) || '用'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="32" fill="${tone}"/>
  <text x="32" y="38" text-anchor="middle" fill="#fff" font-size="20" font-family="sans-serif">${initial}</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function buildReplyTree(
  topic: string,
  seed: number,
  path: string,
  depth: number,
  maxDepth: number,
  count: number,
): ResearchCommentItem[] {
  const replyTemplates = [
    '同问，求置顶',
    `我也卡在「${topic}」这一步`,
    '这个回复有用，收藏了',
    '能再展开讲讲吗？',
    '同意楼上',
    '我按这个方法试了，有效',
  ]
  return Array.from({ length: count }, (_, index) => {
    const diggCount = 6 + ((seed + depth * 11 + index * 13) % 120)
    const childCount = depth < maxDepth ? (seed + index) % 3 : 0
    const replies = buildReplyTree(
      topic,
      seed + index * 3,
      `${path}.${String(index)}`,
      depth + 1,
      maxDepth,
      childCount,
    )
    const replyCount = Math.max(replies.length, childCount > 0 ? childCount + ((seed + index) % 4) : 0)
    const replyRate = Number((replyCount / Math.max(diggCount, 1)).toFixed(3))
    const author = `回复用户${String((seed + depth * 17 + index) % 200)}`
    return {
      id: `c-${path}-${String(index)}`,
      author,
      avatarUrl: mockCommentAvatar(author, seed + depth * 9 + index),
      content: pick(replyTemplates, seed, depth * 5 + index),
      diggCount,
      replyCount,
      replyRate,
      qualityScore: Math.min(99, Math.round(diggCount * 0.08 + replyCount * 2)),
      replies,
    }
  })
}

function buildComments(topic: string, seed: number): ResearchCommentItem[] {
  const templates = [
    `这个「${topic}」切入点很清楚，求完整清单`,
    '前 3 秒钩子很强，我直接留下来了',
    '有没有适合新手的版本？评论区置顶一下',
    '同赛道我试过，转化主要看评论区答疑',
    '结构学到了：结论先行再拆步骤',
    '能不能对比一下失败案例？',
    '字幕节奏很好，适合二创参考',
    '评论区答疑这段可以直接做成专栏',
    '开头痛点太准了，差点以为在说我',
    '方法拆得清楚，比空谈人设强',
    '求一份可复制的口播提纲',
    '完播和收藏应该会不错',
    '这类选题搜索词也友好',
    '反例对比再多一点会更好',
    'CTA 引导自然，不硬广',
    '适合中腰部账号连续验证',
    '信息密度刚好，没有注水',
    '想看更多现场观察类样本',
  ]

  return templates.map((content, index) => {
    const diggCount = 80 + ((seed + index * 17) % 900)
    const nested = buildReplyTree(topic, seed + index * 7, `root-${String(index)}`, 1, 3, 1 + ((seed + index) % 3))
    const replyCount = Math.max(nested.length, 4 + ((seed + index * 9) % 60))
    const replyRate = Number((replyCount / Math.max(diggCount, 1)).toFixed(3))
    const author = `样本用户${String((seed + index) % 90)}`
    return {
      id: `root-${String(seed)}-${String(index)}`,
      author,
      avatarUrl: mockCommentAvatar(author, seed + index),
      content,
      diggCount,
      replyCount,
      replyRate,
      qualityScore: Math.min(99, Math.round(diggCount * 0.04 + replyCount * 1.6)),
      replies: nested,
    }
  }).sort((a, b) => b.qualityScore - a.qualityScore)
}

export function buildMockResearchVideos(topic: TopicItem, count = 24): ResearchVideoDraft[] {
  const seed = hashSeed(`${topic.id}:${topic.title}`)
  const topicName = topic.title

  return Array.from({ length: count }, (_, index) => {
    const videoType = pick(TYPE_CYCLE, seed, index)
    const authorUniqueId = `sample_${String(seed % 10000)}_${String(index + 1)}`
    const media = MOCK_MEDIA[index % MOCK_MEDIA.length]!
    const durationSec = media.durationSec
    const playUrl = MOCK_PLAY_URL
    const coverUrl = mockCoverDataUrl(media.label, media.tone)
    const matchScore = Math.max(62, 96 - index * 3 - ((seed + index) % 5))

    const scriptSegments: ResearchScriptSegment[] = [
      {
        label: '开头钩子',
        purpose: '3 秒内抛出选题痛点，拦住划走',
        text: `别再泛做内容了——如果你做「${topicName}」，先把人群缩到具体场景。`,
      },
      {
        label: '痛点共鸣',
        purpose: '让目标用户觉得“说的就是我”',
        text: '很多人不是不会拍，是选题太宽，完播和私信都对不上。',
      },
      {
        label: '方法拆解',
        purpose: '给可执行步骤，便于收藏',
        text: `围绕「${topicName}」固定：场景切入 → 一步方法 → 反例对比 → 行动清单。`,
      },
      {
        label: '收束 CTA',
        purpose: '引导评论/关注，沉淀互动',
        text: '评论区留下你现在卡在哪一步，我按高频问题做下期。',
      },
    ]

    const hookEnd = Math.min(2, Math.max(1, Math.floor(durationSec * 0.15)))
    const painEnd = Math.min(durationSec - 2, Math.max(hookEnd + 1, Math.floor(durationSec * 0.4)))
    const methodEnd = Math.min(durationSec - 1, Math.max(painEnd + 1, Math.floor(durationSec * 0.8)))
    const structureBlocks: ResearchStructureBlock[] = [
      {
        startSec: 0,
        endSec: hookEnd,
        title: '钩子',
        purpose: '留人',
        editingStyle:
          videoType === '探店'
            ? '门头/环境 sweep，字幕甩出定位，音乐起拍同步'
            : '近景急推 + 关键词闪入，切点落在痛点词上',
      },
      {
        startSec: hookEnd,
        endSec: painEnd,
        title: '痛点',
        purpose: '共鸣',
        editingStyle:
          videoType === '带货'
            ? '前后对比镜头，卖点字幕贴边，少用叠化'
            : '口播/人物特写稳住，字幕逐条点场景，节奏略缓',
      },
      {
        startSec: painEnd,
        endSec: methodEnd,
        title: '方法/案例',
        purpose: '讲点',
        editingStyle:
          videoType === '教程'
            ? '步骤分镜 + 数字角标，每步硬切，字幕密度升高'
            : '正反案例快切，示意图/录屏穿插，结论先行',
      },
      {
        startSec: methodEnd,
        endSec: durationSec,
        title: 'CTA',
        purpose: '互动转化',
        editingStyle: '镜头略推近，提问字幕置底，留停顿方便截图评论',
      },
    ]

    return {
      awemeId: `mock_${authorUniqueId}`,
      coverUrl,
      playUrl,
      title: `${topicName}｜${videoType}样本 ${String(index + 1)}：${pick(
        ['新手避坑', '七天复盘', '高频问题', '结构拆解', '评论区转化'],
        seed,
        index,
      )}`,
      authorNickname: pick(
        [`${topicName.slice(0, 4)}观察员`, `${videoType}实战派`, '中腰部样本号'],
        seed,
        index,
      ),
      authorUniqueId,
      diggCount: 1200 + ((seed + index * 111) % 48000),
      commentCount: 90 + ((seed + index * 37) % 1800),
      shareCount: 40 + ((seed + index * 19) % 900),
      durationSec,
      videoType,
      matchScore,
      profileUrl: playUrl,
      summary: `该片以「${topicName}」为轴，类型偏${videoType}，适合学习开头留人与中段信息密度。`,
      editingStyle: structureBlocks.map((block) => `${block.title}：${block.editingStyle}`).join('；'),
      scriptSegments,
      structureBlocks,
      comments: buildComments(topicName, seed + index),
      takeaways: [
        `开头直接点名「${topicName}」，比宽泛大类更易被检索与完播。`,
        `${structureBlocks[1]!.title}段用于共鸣，不要太早上干货。`,
        '评论区高频求清单/求对比，可做成下期固定栏目。',
        `剪辑上保持「${videoType}」辨识度，避免同片多种人设。`,
      ],
    }
  })
}
