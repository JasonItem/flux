export const LlmChannels = {
  listProviders: 'llm:listProviders',
  createProvider: 'llm:createProvider',
  updateProvider: 'llm:updateProvider',
  deleteProvider: 'llm:deleteProvider',
  listModels: 'llm:listModels',
  createModel: 'llm:createModel',
  updateModel: 'llm:updateModel',
  deleteModel: 'llm:deleteModel',
  setDefaultModel: 'llm:setDefaultModel',
  listUsage: 'llm:listUsage',
  getUsageStats: 'llm:getUsageStats',
  listRemoteModels: 'llm:listRemoteModels',
  chat: 'llm:chat',
  chatStreamStart: 'llm:chatStreamStart',
  chatStreamAbort: 'llm:chatStreamAbort',
  chatStreamChunk: 'llm:chatStreamChunk',
  chatStreamEnd: 'llm:chatStreamEnd',
  chatStreamError: 'llm:chatStreamError',
} as const

export interface LlmProvider {
  id: string
  name: string
  baseUrl: string
  apiKeyMasked: string
  hasApiKey: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface LlmProviderCreateInput {
  name: string
  baseUrl: string
  apiKey: string
  enabled?: boolean
}

export interface LlmProviderUpdateInput {
  id: string
  name?: string
  baseUrl?: string
  /** Omit or pass empty string to keep the existing key. */
  apiKey?: string
  enabled?: boolean
}

export interface LlmModel {
  id: string
  providerId: string
  providerName: string
  name: string
  modelId: string
  enabled: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface LlmModelCreateInput {
  providerId: string
  name: string
  modelId: string
  enabled?: boolean
  isDefault?: boolean
}

export interface LlmModelUpdateInput {
  id: string
  providerId?: string
  name?: string
  modelId?: string
  enabled?: boolean
}

export type LlmChatRole = 'system' | 'user' | 'assistant'

export interface LlmChatMessage {
  role: LlmChatRole
  content: string
}

export interface LlmChatInput {
  /** Library model row id. Omit to use the default enabled model. */
  modelId?: string
  messages: LlmChatMessage[]
  temperature?: number
  maxTokens?: number
}

export interface LlmChatUsage {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

export interface LlmChatResult {
  requestId: string
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  content: string
  usage: LlmChatUsage
}

export interface LlmStreamStartResult {
  requestId: string
  modelId: string
  modelName: string
  providerId: string
  providerName: string
}

export interface LlmStreamChunkEvent {
  requestId: string
  delta: string
}

export interface LlmStreamEndEvent {
  requestId: string
  content: string
  usage: LlmChatUsage
}

export interface LlmStreamErrorEvent {
  requestId: string
  message: string
}

export interface LlmStreamHandlers {
  onChunk?: (event: LlmStreamChunkEvent) => void
  onDone?: (event: LlmStreamEndEvent) => void
  onError?: (event: LlmStreamErrorEvent) => void
}

export interface LlmUsageRecord {
  id: string
  createdAt: string
  providerName: string
  modelName: string
  modelId: string
  endpoint: string
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  status: 'success' | 'error'
  error: string | null
}

export interface LlmUsageDayStat {
  date: string
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface LlmUsageModelStat {
  modelName: string
  modelId: string
  requests: number
  totalTokens: number
}

export interface LlmUsageStats {
  days: LlmUsageDayStat[]
  byModel: LlmUsageModelStat[]
  totals: {
    requests: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    successCount: number
    errorCount: number
  }
}

export interface LlmRemoteModel {
  id: string
  name: string
  ownedBy: string | null
}

export interface LlmApi {
  listProviders: () => Promise<LlmProvider[]>
  createProvider: (input: LlmProviderCreateInput) => Promise<LlmProvider>
  updateProvider: (input: LlmProviderUpdateInput) => Promise<LlmProvider>
  deleteProvider: (id: string) => Promise<void>
  listModels: () => Promise<LlmModel[]>
  createModel: (input: LlmModelCreateInput) => Promise<LlmModel>
  updateModel: (input: LlmModelUpdateInput) => Promise<LlmModel>
  deleteModel: (id: string) => Promise<void>
  setDefaultModel: (id: string) => Promise<LlmModel>
  listUsage: (limit?: number) => Promise<LlmUsageRecord[]>
  getUsageStats: (days?: number) => Promise<LlmUsageStats>
  listRemoteModels: (providerId: string) => Promise<LlmRemoteModel[]>
  chat: (input: LlmChatInput) => Promise<LlmChatResult>
  chatStream: (input: LlmChatInput, handlers?: LlmStreamHandlers) => Promise<LlmStreamStartResult>
  abortStream: (requestId: string) => Promise<void>
}
