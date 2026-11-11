import type { DouyinAccount, DouyinVideoItem } from '../../shared/tikhub'
import type {
  TrackCompositionItem,
  TrackDiagnosis,
  TrackInfluencer,
} from '../../shared/track'
import type { TrackCandidateInsert } from './repository'

function clampScore(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)))
}

interface DomainSignal {
  key: string
  label: string
  words: string[]
  niches: string[]
}

interface FormatSignal {
  key: string
  label: string
  words: string[]
}

interface ScoredSignal {
  key: string
  label: string
  score: number
  evidence: string[]
}

const DOMAINS: DomainSignal[] = [
  {
    key: 'crossborder',
    label: '跨境电商',
    words: [
      '跨境',
      '出海',
      '外贸',
      '独立站',
      '亚马逊',
      'amazon',
      'shopify',
      '阿里国际',
      '国际站',
      '1688',
      'temu',
      'tiktok shop',
      '选品',
      '货盘',
      '创拓',
      '大表姐',
    ],
    niches: ['新手入门', '选品避坑', '店铺运营', '广告投放', '物流合规'],
  },
  {
    key: 'local-life',
    label: '本地生活',
    words: ['探店', '同城', '本地', '洛阳', '美食街', '优惠', '团购', '打卡'],
    niches: ['探店测评', '同城优惠', '街区观察'],
  },
  {
    key: 'career',
    label: '职场成长',
    words: ['职场', '面试', '副业', '涨薪', '汇报', '管理', '简历', '跳槽'],
    niches: ['面试通关', '升职沟通', '副业起步'],
  },
  {
    key: 'tech',
    label: '数码科技',
    words: ['数码', '手机', '测评', 'ai', '科技', '软件', '工具', '效率'],
    niches: ['效率工具', '产品测评', 'AI实操'],
  },
  {
    key: 'beauty',
    label: '美妆穿搭',
    words: ['美妆', '穿搭', '护肤', '妆教', '时尚', '口红'],
    niches: ['平价护肤', '通勤穿搭', '妆容教程'],
  },
  {
    key: 'food',
    label: '美食烹饪',
    words: ['美食', '做饭', '料理', '食谱', '厨房', '家常菜'],
    niches: ['快手家常菜', '减脂餐', '一人食'],
  },
  {
    key: 'parenting',
    label: '亲子育儿',
    words: ['育儿', '宝宝', '亲子', '母婴', '孩子', '辅食'],
    niches: ['辅食教程', '亲子沟通', '早教互动'],
  },
  {
    key: 'fitness',
    label: '运动健身',
    words: ['健身', '减脂', '训练', '跑步', '拉伸', '无氧'],
    niches: ['居家减脂', '新手训练', '拉伸恢复'],
  },
  {
    key: 'finance',
    label: '理财副业',
    words: ['理财', '投资', '基金', '赚钱', '被动收入', '存钱'],
    niches: ['小白理财', '副业变现', '记账方法'],
  },
]

const FORMATS: FormatSignal[] = [
  {
    key: 'knowledge',
    label: '知识干货',
    words: ['干货', '教程', '方法', '技巧', '怎么', '避坑', '步骤', '清单', '公式'],
  },
  {
    key: 'case',
    label: '实操复盘',
    words: ['复盘', '案例', '实操', '拆解', '对比', '数据', '实测'],
  },
  {
    key: 'story',
    label: '经验故事',
    words: ['经历', '故事', '我是', '从0', '转型', '踩坑', '亲身'],
  },
  {
    key: 'news',
    label: '资讯解读',
    words: ['解读', '政策', '趋势', '2025', '2026', '最新', '行情', '变化'],
  },
  {
    key: 'vlog',
    label: '现场观察',
    words: ['探访', '带你', '看看', '现场', 'vlog', '跟拍', '一日'],
  },
]

const AUDIENCE_WORDS = ['新手', '小白', '宝妈', '店主', '运营', '职场人', '大学生', '转型']

function normalize(text: string): string {
  return text.toLowerCase()
}

function engagementWeight(video: DouyinVideoItem): number {
  return Math.max(
    1,
    Math.log10(1 + video.diggCount * 1.2 + video.commentCount * 2.2 + video.shareCount * 1.6),
  )
}

function scoreCatalog(
  texts: Array<{ text: string; weight: number }>,
  catalog: Array<{ key: string; label: string; words: string[] }>,
): ScoredSignal[] {
  return catalog
    .map((item) => {
      const evidence = new Map<string, number>()
      let score = 0
      for (const entry of texts) {
        for (const word of item.words) {
          if (!entry.text.includes(word.toLowerCase())) continue
          score += entry.weight
          evidence.set(word, (evidence.get(word) ?? 0) + entry.weight)
        }
      }
      const evidenceList = [...evidence.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([word]) => word)
      return { key: item.key, label: item.label, score, evidence: evidenceList }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
}

function buildComposition(domains: ScoredSignal[], formats: ScoredSignal[]): TrackCompositionItem[] {
  const mixed = [...domains, ...formats].sort((a, b) => b.score - a.score).slice(0, 5)
  const total = mixed.reduce((sum, item) => sum + item.score, 0) || 1
  return mixed.map((item) => ({
    label: item.label,
    share: Math.max(8, Math.round((item.score / total) * 100)),
    signal: item.evidence.slice(0, 3).join('、') || item.label,
  }))
}

function topVideosForSignals(
  videos: DouyinVideoItem[],
  words: string[],
  limit = 2,
): DouyinVideoItem[] {
  if (videos.length === 0 || words.length === 0) return videos.slice(0, limit)
  return [...videos]
    .map((video) => {
      const text = normalize(video.description)
      const hit = words.some((word) => text.includes(word.toLowerCase()))
      return { video, hit, weight: engagementWeight(video) }
    })
    .filter((item) => item.hit)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((item) => item.video)
}

function influencerFor(_trackName: string, _index: number): TrackInfluencer[] {
  // 红人由 enrichMarket 用 TikHub 搜索补齐，避免展示假粉丝数
  return []
}

function buildSearchHintForName(name: string, domainLabel: string): string {
  const stripped = name
    .replace(
      /产业观察|创业实战|实战观察|趋势解读|人物故事|政策解读|新手避坑|案例拆解|知识干货|实操复盘|经验故事|指南|干货/g,
      '',
    )
    .trim()
  if (stripped.length >= 2 && stripped.length <= 8) return stripped
  return domainLabel.slice(0, 6) || name.slice(0, 6)
}

function buildTrackNames(args: {
  domains: ScoredSignal[]
  formats: ScoredSignal[]
  cityHint: string | null
  audienceHint: string | null
  primaryDomain: string
  primaryFormat: string
}): Array<{ name: string; searchHint: string }> {
  const names: string[] = []
  const push = (name: string) => {
    const cleaned = name.replace(/\s+/g, '').trim()
    if (!cleaned || names.includes(cleaned)) return
    // 禁止过宽的大类名
    if (cleaned === '知识干货' || cleaned === '实操复盘' || cleaned === '经验故事') return
    names.push(cleaned)
  }

  const d0 = args.domains[0]
  const d1 = args.domains[1]
  const d2 = args.domains[2]
  const domainMeta = DOMAINS.find((item) => item.key === d0?.key)
  const domainMeta1 = DOMAINS.find((item) => item.key === d1?.key)

  // 优先「领域 + 方向」宽标题，少拼城市/体裁后缀
  if (d0) push(`${d0.label}产业观察`)
  if (d0) push(`${d0.label}创业实战`)
  if (d0) push(`${d0.label}人物故事`)
  if (d0 && domainMeta?.niches[0]) push(`${d0.label}${domainMeta.niches[0]}`)
  if (d1) push(`${d1.label}实战观察`)
  if (d0 && domainMeta?.niches[1]) push(`${d0.label}${domainMeta.niches[1]}`)
  if (d1 && domainMeta1?.niches[0]) push(`${d1.label}${domainMeta1.niches[0]}`)
  if (d2) push(`${d2.label}趋势解读`)
  if (args.audienceHint && d0) push(`${args.audienceHint}${d0.label}指南`)
  if (d0) push(`${d0.label}工具方法`)

  const fillers = [
    `${args.primaryDomain}新手避坑`,
    `${args.primaryDomain}案例拆解`,
    `${args.primaryDomain}趋势解读`,
    `${args.primaryDomain}政策解读`,
    `${args.primaryDomain}${args.primaryFormat}`,
  ]
  for (const filler of fillers) {
    if (names.length >= 8) break
    push(filler)
  }

  return names.slice(0, 8).map((name) => ({
    name,
    searchHint: buildSearchHintForName(name, args.primaryDomain),
  }))
}

export function buildMockTrackResult(
  account: DouyinAccount,
  videos: DouyinVideoItem[],
): { diagnosis: TrackDiagnosis; candidates: TrackCandidateInsert[] } {
  const profileText = normalize(
    [account.nickname, account.signature ?? '', account.uniqueId ?? ''].join('\n'),
  )
  const weightedTexts = [
    { text: profileText, weight: 3.2 },
    ...videos.map((video) => ({
      text: normalize(video.description),
      weight: engagementWeight(video),
    })),
  ]

  const domains = scoreCatalog(weightedTexts, DOMAINS)
  const formats = scoreCatalog(weightedTexts, FORMATS)
  const composition = buildComposition(domains, formats)

  const primaryDomain = domains[0]?.label ?? (account.signature ? '垂直内容' : '综合内容')
  const primaryFormat = formats[0]?.label ?? '知识干货'
  const fullText = weightedTexts.map((item) => item.text).join('\n')
  const cityHint = /洛阳|郑州|西安|成都|杭州|广州|深圳|上海|北京|武汉|南京|苏州/.exec(fullText)?.[0] ?? null
  const audienceHint = AUDIENCE_WORDS.find((word) => fullText.includes(word.toLowerCase())) ?? null

  const trackSeeds = buildTrackNames({
    domains,
    formats,
    cityHint,
    audienceHint,
    primaryDomain,
    primaryFormat,
  })
  const trackNames = trackSeeds.map((item) => item.name)

  const avgDigg =
    videos.length > 0
      ? videos.reduce((sum, item) => sum + item.diggCount, 0) / videos.length
      : 0
  const avgComment =
    videos.length > 0
      ? videos.reduce((sum, item) => sum + item.commentCount, 0) / videos.length
      : 0
  const engagementBoost = clampScore(Math.log10(Math.max(avgDigg, 1)) * 18)
  const commentBoost = clampScore(Math.log10(Math.max(avgComment, 1)) * 16)
  const followerBoost = clampScore(Math.log10(Math.max(account.followerCount, 1)) * 14)

  const topSignals = [
    ...domains.slice(0, 2).flatMap((item) => item.evidence.slice(0, 2)),
    ...formats.slice(0, 2).flatMap((item) => item.evidence.slice(0, 2)),
  ].slice(0, 8)

  const bestVideo = [...videos].sort((a, b) => engagementWeight(b) - engagementWeight(a))[0]

  const diagnosis: TrackDiagnosis = {
    positioning:
      account.signature?.trim() ||
      `账号「${account.nickname}」当前更贴近「${trackNames[0]}」：建议用统一人设连续验证 7～14 天。`,
    composition:
      composition.length > 0
        ? composition
        : [
            {
              label: '信号不足',
              share: 100,
              signal: '近作/简介关键词较少，建议先发 3 条细分试探内容',
            },
          ],
    strengths: [
      topSignals.length > 0
        ? `加权识别到关键词：${topSignals.join('、')}（简介权重更高，互动高的近作权重更高）。`
        : '人设尚未锁死，转向精确赛道的试错成本较低。',
      videos.length > 0
        ? `近 ${String(videos.length)} 条作品平均赞 ${String(Math.round(avgDigg))}、评 ${String(Math.round(avgComment))}，可用来验证赛道假设。`
        : '暂无近作样本，可先按推荐赛道小流量试发再回收数据。',
      bestVideo?.description
        ? `高互动近作线索：${bestVideo.description.slice(0, 36)}${bestVideo.description.length > 36 ? '…' : ''}`
        : account.followerCount >= 1000
          ? '已有基础粉丝盘，细分赛道反馈会更快。'
          : '体量小，更适合窄赛道冷启动。',
    ],
    weaknesses: [
      domains.length === 0
        ? '领域信号偏弱，建议在标题/口播里主动露出具体业务词。'
        : '若只停留在大类标签，推荐与复访会不稳定，必须压到细分赛道。',
      videos.length < 6
        ? '作品样本偏少，成分占比会随下一轮发布明显变化。'
        : '同类表达易撞车，需要更具体的场景切口与固定栏目。',
      audienceHint
        ? `已识别人群词「${audienceHint}」，对外定位还需写成「帮谁解决什么问题」。`
        : '对外一句话定位仍缺明确人群，建议补「新手/店主/运营」等对象词。',
    ],
  }

  const candidates: TrackCandidateInsert[] = trackSeeds.map((seed, index) => {
    const name = seed.name
    const relatedDomain = domains.find((item) => name.includes(item.label))
    const relatedFormat = formats.find((item) => name.includes(item.label))
    const evidenceWords = [
      ...(relatedDomain?.evidence ?? domains[0]?.evidence ?? []),
      ...(relatedFormat?.evidence ?? formats[0]?.evidence ?? []),
    ].slice(0, 4)
    const matchedVideos = topVideosForSignals(videos, evidenceWords, 2)

    const heat = clampScore(56 + engagementBoost * 0.22 + commentBoost * 0.08 - index * 3)
    const competition = clampScore(34 + followerBoost * 0.18 + index * 6 + (relatedDomain ? 0 : 8))
    const potential = clampScore(82 - index * 4 + (100 - competition) * 0.14 + (relatedDomain?.score ?? 0))

    const evidence = [
      relatedDomain
        ? `领域「${relatedDomain.label}」加权分 ${relatedDomain.score.toFixed(1)}（词：${relatedDomain.evidence.join('、') || '综合'}）`
        : `以「${primaryDomain}」作为主领域假设`,
      relatedFormat
        ? `体裁「${relatedFormat.label}」加权分 ${relatedFormat.score.toFixed(1)}`
        : `体裁倾向「${primaryFormat}」`,
      ...matchedVideos.map(
        (video) =>
          `近作支撑（赞${String(video.diggCount)}）：${video.description.slice(0, 30)}${video.description.length > 30 ? '…' : ''}`,
      ),
      matchedVideos.length === 0
        ? `简介/昵称线索：${(account.signature || account.nickname).slice(0, 28)}`
        : `互动结构：赞均 ${String(Math.round(avgDigg))} / 评均 ${String(Math.round(avgComment))}`,
    ].slice(0, 5)

    return {
      name,
      summary: `把账号收敛到「${name}」，固定栏目与开头话术，连续验证完播与收藏。`,
      heatScore: heat,
      competitionScore: competition,
      potentialScore: potential,
      metrics: null,
      reason: `本地算法按「简介加权 + 近作互动加权」组合出赛道「${name}」，市场指标待抖音搜索校准。`,
      evidence,
      influencers: influencerFor(name, index + 1),
      sortOrder: index,
      searchHint: seed.searchHint,
    }
  })

  return { diagnosis, candidates }
}
