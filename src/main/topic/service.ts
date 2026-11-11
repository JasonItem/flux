import type { TopicItem, TopicManualInput, TopicUpdateInput } from '../../shared/topic'
import type { TrackRepository } from '../track/repository'
import type { TopicRepository } from './repository'

export interface TopicService {
  listTopics: (accountId?: string) => TopicItem[]
  addFromTrack: (assessmentId: string, candidateId: string) => TopicItem
  addManual: (input: TopicManualInput) => TopicItem
  updateTopic: (input: TopicUpdateInput) => TopicItem
  deleteTopic: (id: string) => void
}

export function createTopicService(
  topics: TopicRepository,
  tracks: TrackRepository,
): TopicService {
  return {
    listTopics: (accountId) => topics.list(accountId),

    addFromTrack: (assessmentId, candidateId) => {
      const existing = topics.findByCandidateId(candidateId)
      if (existing) return existing

      const { assessmentAccountId, candidate } = tracks.getCandidate(
        assessmentId,
        candidateId,
      )
      return topics.addFromTrack({
        accountId: assessmentAccountId,
        assessmentId,
        candidateId: candidate.id,
        title: candidate.name,
        summary: candidate.summary,
        domain: candidate.name,
        heatScore: candidate.heatScore,
        competitionScore: candidate.competitionScore,
        potentialScore: candidate.potentialScore,
        reason: candidate.reason,
      })
    },

    addManual: (input) => topics.addManual(input),

    updateTopic: (input) => topics.update(input),
    deleteTopic: (id) => {
      topics.delete(id)
    },
  }
}
