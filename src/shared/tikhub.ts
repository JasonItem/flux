export const TikHubChannels = {
  getSettings: 'tikhub:getSettings',
  updateSettings: 'tikhub:updateSettings',
  testConnection: 'tikhub:testConnection',
  getBalance: 'tikhub:getBalance',
  getUsage: 'tikhub:getUsage',
  listAccounts: 'tikhub:listAccounts',
  resolveAccount: 'tikhub:resolveAccount',
  bindAccount: 'tikhub:bindAccount',
  refreshAccount: 'tikhub:refreshAccount',
  deleteAccount: 'tikhub:deleteAccount',
  setActiveAccount: 'tikhub:setActiveAccount',
  listAccountVideos: 'tikhub:listAccountVideos',
} as const

/** Fired in the renderer after TikHub settings change so the sidebar can refresh. */
export const TikHubSettingsChangedEvent = 'studio:tikhub-settings-changed'

export interface TikHubSettings {
  endpoint: string
  apiTokenMasked: string
  hasApiToken: boolean
  timeoutSeconds: number
  enabled: boolean
  updatedAt: string
}

export interface TikHubSettingsUpdateInput {
  endpoint?: string
  /** Omit or empty to keep the existing token. */
  apiToken?: string
  timeoutSeconds?: number
  enabled?: boolean
}

export interface TikHubConnectionTestResult {
  ok: boolean
  email?: string
  balance?: number
  freeCredit?: number
  apiKeyName?: string
  message: string
}

export interface TikHubBalanceStatus {
  /** Token saved and TikHub enabled. */
  ready: boolean
  ok: boolean
  balance?: number
  freeCredit?: number
  email?: string
  message: string
  fetchedAt: string | null
}

export interface TikHubCallRecord {
  id: string
  createdAt: string
  path: string
  ok: boolean
  statusCode: number | null
  message: string | null
}

export interface TikHubUsageDayStat {
  date: string
  requests: number
  successCount: number
  errorCount: number
}

export interface TikHubUsageOverview {
  ready: boolean
  ok: boolean
  message: string
  balance?: number
  freeCredit?: number
  email?: string
  /** Today's request count from TikHub official daily usage API when available. */
  todayRequests?: number
  /** Today's spend in USD from TikHub daily usage API when available. */
  todayCostUsd?: number
  series: TikHubUsageDayStat[]
  recentCalls: TikHubCallRecord[]
  totals: {
    requests: number
    successCount: number
    errorCount: number
  }
}

export interface DouyinAccount {
  id: string
  secUserId: string
  uid: string | null
  uniqueId: string | null
  nickname: string
  avatarUrl: string | null
  signature: string | null
  followerCount: number
  followingCount: number
  awemeCount: number
  totalFavorited: number
  profileUrl: string | null
  sourceInput: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface DouyinAccountPreview {
  secUserId: string
  uid: string | null
  uniqueId: string | null
  nickname: string
  avatarUrl: string | null
  signature: string | null
  followerCount: number
  followingCount: number
  awemeCount: number
  totalFavorited: number
  profileUrl: string | null
  sourceInput: string
}

export interface DouyinVideoItem {
  awemeId: string
  description: string
  coverUrl: string | null
  /** 可直链播放时的地址（CDN，可能过期） */
  playUrl: string | null
  createTime: number | null
  diggCount: number
  commentCount: number
  shareCount: number
  playCount: number
  durationMs: number | null
}

export interface DouyinVideoPage {
  items: DouyinVideoItem[]
  maxCursor: string
  hasMore: boolean
}

export interface TikHubApi {
  getSettings: () => Promise<TikHubSettings>
  updateSettings: (input: TikHubSettingsUpdateInput) => Promise<TikHubSettings>
  testConnection: () => Promise<TikHubConnectionTestResult>
  getBalance: () => Promise<TikHubBalanceStatus>
  getUsage: (days?: number) => Promise<TikHubUsageOverview>
  listAccounts: () => Promise<DouyinAccount[]>
  resolveAccount: (input: string) => Promise<DouyinAccountPreview>
  bindAccount: (preview: DouyinAccountPreview) => Promise<DouyinAccount>
  refreshAccount: (id: string) => Promise<DouyinAccount>
  deleteAccount: (id: string) => Promise<void>
  setActiveAccount: (id: string) => Promise<DouyinAccount>
  listAccountVideos: (
    id: string,
    options?: { maxCursor?: string; count?: number },
  ) => Promise<DouyinVideoPage>
}
