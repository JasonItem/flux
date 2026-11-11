export const TopicChannels = {
  listTopics: 'topic:listTopics',
  addFromTrack: 'topic:addFromTrack',
  addManual: 'topic:addManual',
  updateTopic: 'topic:updateTopic',
  deleteTopic: 'topic:deleteTopic',
} as const

export interface TopicManualInput {
  accountId: string
  title: string
  summary?: string
  reason?: string
  domain?: string
}

export type TopicStatus = 'inbox' | 'kept' | 'excluded' | 'selected'

export interface TopicItem {
  id: string
  accountId: string
  accountNickname: string
  assessmentId: string | null
  candidateId: string | null
  title: string
  summary: string
  domain: string
  heatScore: number | null
  competitionScore: number | null
  potentialScore: number | null
  reason: string
  source: 'track' | 'manual'
  status: TopicStatus
  createdAt: string
  updatedAt: string
}

export interface TopicUpdateInput {
  id: string
  status?: TopicStatus
  title?: string
  summary?: string
}

export interface TopicApi {
  listTopics: (accountId?: string) => Promise<TopicItem[]>
  addFromTrack: (assessmentId: string, candidateId: string) => Promise<TopicItem>
  addManual: (input: TopicManualInput) => Promise<TopicItem>
  updateTopic: (input: TopicUpdateInput) => Promise<TopicItem>
  deleteTopic: (id: string) => Promise<void>
}
