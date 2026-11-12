export const RadarChannels = {
  listAccounts: 'radar:listAccounts',
  addAccount: 'radar:addAccount',
  removeAccount: 'radar:removeAccount',
  setAccountEnabled: 'radar:setAccountEnabled',
  syncAccount: 'radar:syncAccount',
  syncAllAccounts: 'radar:syncAllAccounts',
  listSignals: 'radar:listSignals',
  refreshHot: 'radar:refreshHot',
  getRules: 'radar:getRules',
  updateRules: 'radar:updateRules',
} as const

export type RadarSignalFilter = 'all' | 'high' | 'new' | 'hot'

export interface RadarAccount {
  id: string
  secUserId: string
  uid: string | null
  uniqueId: string | null
  nickname: string
  avatarUrl: string | null
  signature: string | null
  followerCount: number
  awemeCount: number
  profileUrl: string | null
  sourceInput: string
  enabled: boolean
  lastSyncedAt: string | null
  workCount: number
  createdAt: string
  updatedAt: string
}

export interface RadarWork {
  id: string
  awemeId: string
  radarAccountId: string | null
  authorNickname: string
  authorUniqueId: string | null
  title: string
  coverUrl: string | null
  playUrl: string | null
  profileUrl: string | null
  diggCount: number
  commentCount: number
  shareCount: number
  playCount: number
  durationSec: number
  publishAt: string | null
  isHigh: boolean
  isNew: boolean
  isHot: boolean
  source: 'account' | 'hot'
  firstSeenAt: string
  updatedAt: string
}

export interface RadarRules {
  highMinDigg: number
  highMinPlay: number
  newWithinHours: number
  hotKeywords: string
  autoSyncEnabled: boolean
  syncIntervalMinutes: number
  updatedAt: string
}

export interface RadarRulesUpdateInput {
  highMinDigg?: number
  highMinPlay?: number
  newWithinHours?: number
  hotKeywords?: string
  autoSyncEnabled?: boolean
  syncIntervalMinutes?: number
}

export interface RadarSignalsQuery {
  filter?: RadarSignalFilter
  limit?: number
}

export interface RadarSyncResult {
  accountId: string
  nickname: string
  fetched: number
  upserted: number
}

export interface RadarApi {
  listAccounts: () => Promise<RadarAccount[]>
  addAccount: (input: string) => Promise<RadarAccount>
  removeAccount: (id: string) => Promise<void>
  setAccountEnabled: (id: string, enabled: boolean) => Promise<RadarAccount>
  syncAccount: (id: string) => Promise<RadarSyncResult>
  syncAllAccounts: () => Promise<RadarSyncResult[]>
  listSignals: (query?: RadarSignalsQuery) => Promise<RadarWork[]>
  refreshHot: () => Promise<{ fetched: number; upserted: number }>
  getRules: () => Promise<RadarRules>
  updateRules: (input: RadarRulesUpdateInput) => Promise<RadarRules>
}