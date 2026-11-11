import type { DouyinAccount } from '../../shared/tikhub'
import type { TrackAssessment, TrackAssessmentSummary, TrackCandidate } from '../../shared/track'
import type { LlmService } from '../llm/service'
import type { TopicRepository } from '../topic/repository'
import type { TikHubService } from '../tikhub/service'
import { enrichTrackCandidatesWithMarket } from './enrichMarket'
import { analyzeTrackWithLlm } from './llmAnalyze'
import { buildMockTrackResult } from './mockAnalyze'
import type { TrackCandidateInsert, TrackRepository } from './repository'

export interface TrackService {
  listAssessments: (accountId?: string) => TrackAssessmentSummary[]
  getAssessment: (
    id: string,
    options?: { enrich?: boolean },
  ) => Promise<TrackAssessment>
  startAssessment: (accountId?: string) => Promise<TrackAssessment>
  deleteAssessment: (id: string) => void
}

function resolveAccount(tikhub: TikHubService, accountId?: string): DouyinAccount {
  const accounts = tikhub.listAccounts()
  if (accounts.length === 0) {
    throw new Error('请先在「账号管理」绑定至少一个抖音账号')
  }
  if (accountId) {
    const matched = accounts.find((item) => item.id === accountId)
    if (!matched) throw new Error('指定账号不存在')
    return matched
  }
  return accounts.find((item) => item.isActive) ?? accounts[0]!
}

function isFakeInfluencer(item: TrackCandidate['influencers'][number]): boolean {
  const uniqueId = item.uniqueId ?? ''
  if (/^cb_\d+_/i.test(uniqueId)) return true
  if ((item.avatarUrl ?? '').includes('dicebear.com')) return true
  if (/观察员$|实战派$/.test(item.nickname) && /^cb_/i.test(uniqueId)) return true
  return false
}

function needsMarketEnrichment(assessment: TrackAssessment): boolean {
  if (assessment.status !== 'ready') return false
  return assessment.candidates.some((candidate) => {
    const hasFake = candidate.influencers.some(isFakeInfluencer)
    const hasRealInfluencer = candidate.influencers.some(
      (item) => !isFakeInfluencer(item) && (item.followerCount > 0 || Boolean(item.uniqueId)),
    )
    const hasMarketEvidence = candidate.evidence.some(
      (item) => item.includes('抖音搜索') || item.includes('用户搜索') || item.includes('账号近作（'),
    )
    const hasLegacySignalEvidence = candidate.evidence.some(
      (item) => item.includes('领域信号') || item.includes('体裁信号'),
    )
    const missingMetrics =
      !candidate.metrics ||
      (candidate.metrics.sampleVideoCount <= 0 && candidate.metrics.avgPlayCount <= 0)
    const tooFewInfluencers =
      candidate.influencers.filter((item) => !isFakeInfluencer(item)).length < 4
    const hasLegacyPerCapitaPlay =
      candidate.reason.includes('人均浏览') ||
      candidate.evidence.some((item) => item.includes('人均浏览'))
    return (
      hasFake ||
      !hasRealInfluencer ||
      tooFewInfluencers ||
      !hasMarketEvidence ||
      hasLegacySignalEvidence ||
      hasLegacyPerCapitaPlay ||
      missingMetrics
    )
  })
}

export function createTrackService(
  repo: TrackRepository,
  tikhub: TikHubService,
  topics: TopicRepository,
  llm: LlmService,
): TrackService {
  function withTopicFlags(assessment: TrackAssessment): TrackAssessment {
    const ids = assessment.candidates.map((item) => item.id)
    const added = topics.listCandidateIds(ids)
    return {
      ...assessment,
      candidates: assessment.candidates.map((item) => ({
        ...item,
        influencers: item.influencers.filter((influencer) => !isFakeInfluencer(influencer)),
        addedAsTopic: added.has(item.id),
      })),
    }
  }

  async function enrichExisting(assessment: TrackAssessment): Promise<TrackAssessment> {
    const account = resolveAccount(tikhub, assessment.accountId)
    let videos = [] as Awaited<ReturnType<TikHubService['listAccountVideos']>>['items']
    try {
      const page = await tikhub.listAccountVideos(account.id, { count: 18 })
      videos = page.items
    } catch {
      videos = []
    }

    const seed: TrackCandidateInsert[] = assessment.candidates.map((item) => ({
      name: item.name,
      summary: item.summary,
      heatScore: item.heatScore,
      competitionScore: item.competitionScore,
      potentialScore: item.potentialScore,
      metrics: item.metrics,
      reason: item.reason,
      evidence: item.evidence,
      influencers: [],
      sortOrder: item.sortOrder,
    }))

    const enriched = await enrichTrackCandidatesWithMarket({
      tikhub,
      account,
      accountVideos: videos,
      candidates: seed,
    })

    // 按名称回写（enrich 可能重排），避免 index 错位
    for (const candidate of assessment.candidates) {
      const patch = enriched.find((item) => item.name === candidate.name)
      if (!patch) continue
      repo.updateCandidateMarket(candidate.id, {
        heatScore: patch.heatScore,
        competitionScore: patch.competitionScore,
        potentialScore: patch.potentialScore,
        metrics: patch.metrics,
        reason: patch.reason,
        evidence: patch.evidence,
        influencers: patch.influencers,
      })
    }

    return withTopicFlags(repo.getAssessment(assessment.id))
  }

  return {
    listAssessments: (accountId) => repo.listSummaries(accountId),

    getAssessment: async (id, options) => {
      const current = withTopicFlags(repo.getAssessment(id))
      if (options?.enrich === false) return current
      if (!needsMarketEnrichment(current)) return current
      try {
        return await enrichExisting(current)
      } catch (error) {
        console.warn('[track] market enrich failed', error)
        return current
      }
    },

    startAssessment: async (accountId) => {
      const account = resolveAccount(tikhub, accountId)
      const draft = repo.createRunning(account.id)

      try {
        let videos = [] as Awaited<ReturnType<TikHubService['listAccountVideos']>>['items']
        try {
          const page = await tikhub.listAccountVideos(account.id, { count: 18 })
          videos = page.items
        } catch {
          videos = []
        }

        const local = buildMockTrackResult(account, videos)
        let diagnosis = local.diagnosis
        let candidates = local.candidates
        try {
          const llmResult = await analyzeTrackWithLlm(llm, account, videos, {
            compositionHint: local.diagnosis.composition,
          })
          if (llmResult.source === 'llm') {
            diagnosis = llmResult.diagnosis
            candidates = llmResult.candidates.map((item) => ({
              ...item,
              influencers: [],
            }))
            // 模型常只吐 5 条：用本地宽标题候选补到 6～8，数量不固定死
            if (candidates.length < 6) {
              const seen = new Set(candidates.map((item) => item.name))
              for (const filler of local.candidates) {
                if (candidates.length >= 8) break
                if (seen.has(filler.name)) continue
                seen.add(filler.name)
                candidates.push({
                  ...filler,
                  influencers: [],
                  sortOrder: candidates.length,
                })
              }
            }
          }
        } catch {
          // keep local
        }

        try {
          candidates = await enrichTrackCandidatesWithMarket({
            tikhub,
            account,
            accountVideos: videos,
            candidates,
          })
        } catch (error) {
          console.warn('[track] market enrich on start failed', error)
          candidates = candidates.map((item) => ({
            ...item,
            influencers: [],
            evidence: [
              ...item.evidence,
              '市场搜索暂不可用，热度/竞争/潜力先按账号近作估算；打开详情时会自动重试校准。',
            ].slice(0, 5),
          }))
        }

        return withTopicFlags(repo.markReady(draft.id, diagnosis, candidates))
      } catch (error) {
        const message = error instanceof Error ? error.message : '赛道分析失败'
        return repo.markFailed(draft.id, message)
      }
    },

    deleteAssessment: (id) => {
      repo.deleteAssessment(id)
    },
  }
}
