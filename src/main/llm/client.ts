import type { LlmChatMessage, LlmChatUsage, LlmRemoteModel } from '../../shared/llm'

export interface UpstreamChatRequest {
  baseUrl: string
  apiKey: string
  model: string
  messages: LlmChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface UpstreamChatResponse {
  content: string
  usage: LlmChatUsage
  endpoint: string
}

function normalizeV1Base(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) return trimmed
  return `${trimmed}/v1`
}

function chatEndpoint(baseUrl: string): string {
  return `${normalizeV1Base(baseUrl)}/chat/completions`
}

function modelsEndpoint(baseUrl: string): string {
  return `${normalizeV1Base(baseUrl)}/models`
}

/** Some Chinese gateways (e.g. Xiaomi MiMo) prefer `api-key` over Bearer. */
function authHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim()
  return {
    Authorization: `Bearer ${key}`,
    'api-key': key,
  }
}

/** Known model catalogs when upstream has no /models or listing is gated. */
const FALLBACK_MODELS: Array<{ match: RegExp; models: LlmRemoteModel[] }> = [
  {
    match: /xiaomimimo\.com|mimo\.mi\.com|\bmimo\b/i,
    models: [
      { id: 'mimo-v2.6-flash', name: 'mimo-v2.6-flash', ownedBy: 'xiaomi' },
      { id: 'mimo-v2.6-pro', name: 'mimo-v2.6-pro', ownedBy: 'xiaomi' },
      { id: 'mimo-v2.6-pro-ultraspeed', name: 'mimo-v2.6-pro-ultraspeed', ownedBy: 'xiaomi' },
    ],
  },
]

function fallbackModelsFor(...hints: Array<string | undefined>): LlmRemoteModel[] {
  const haystack = hints.filter(Boolean).join(' ')
  if (!haystack) return []
  for (const entry of FALLBACK_MODELS) {
    if (entry.match.test(haystack)) return entry.models
  }
  return []
}

function emptyUsage(): LlmChatUsage {
  return { promptTokens: null, completionTokens: null, totalTokens: null }
}

function readUsage(payload: unknown): LlmChatUsage {
  if (!payload || typeof payload !== 'object') return emptyUsage()
  const usage = (payload as { usage?: Record<string, unknown> }).usage
  if (!usage) return emptyUsage()
  return {
    promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
    totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text()
  if (!text) return `上游返回 HTTP ${String(response.status)}`
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return json.error?.message || json.message || text
  } catch {
    return text
  }
}

function buildBody(input: UpstreamChatRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream,
  }
  if (input.temperature !== undefined) body.temperature = input.temperature
  if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens
  return body
}

export async function listRemoteModels(input: {
  baseUrl: string
  apiKey: string
  /** Extra text used only for known-model fallbacks (e.g. channel name). */
  hint?: string
  signal?: AbortSignal
}): Promise<LlmRemoteModel[]> {
  const fallback = fallbackModelsFor(input.baseUrl, input.hint)
  const endpoint = modelsEndpoint(input.baseUrl)

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        ...authHeaders(input.apiKey),
        Accept: 'application/json',
      },
      signal: input.signal,
    })

    if (!response.ok) {
      const message = await readErrorMessage(response)
      if (fallback.length > 0) return fallback
      throw new Error(message)
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string; object?: string; owned_by?: string }>
    }
    const list = Array.isArray(payload.data) ? payload.data : []
    const models = list
      .map((item) => {
        const id = typeof item.id === 'string' ? item.id.trim() : ''
        if (!id) return null
        return {
          id,
          name: id,
          ownedBy: typeof item.owned_by === 'string' ? item.owned_by : null,
        } satisfies LlmRemoteModel
      })
      .filter((item): item is LlmRemoteModel => Boolean(item))

    if (models.length === 0 && fallback.length > 0) return fallback

    models.sort((a, b) => a.id.localeCompare(b.id))
    return models
  } catch (error) {
    if (fallback.length > 0) return fallback
    throw error
  }
}

export async function chatCompletion(input: UpstreamChatRequest): Promise<UpstreamChatResponse> {
  const endpoint = chatEndpoint(input.baseUrl)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...authHeaders(input.apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildBody(input, false)),
    signal: input.signal,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('上游响应缺少 choices[0].message.content')
  }

  return {
    content,
    usage: readUsage(payload),
    endpoint,
  }
}

export interface UpstreamStreamHandlers {
  onDelta: (delta: string) => void
}

export async function chatCompletionStream(
  input: UpstreamChatRequest,
  handlers: UpstreamStreamHandlers,
): Promise<UpstreamChatResponse> {
  const endpoint = chatEndpoint(input.baseUrl)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...authHeaders(input.apiKey),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(buildBody(input, true)),
    signal: input.signal,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  if (!response.body) {
    throw new Error('上游未返回可读取的流')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let usage = emptyUsage()

  const consumeEvent = (rawEvent: string): void => {
    const lines = rawEvent.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data) continue
      if (data === '[DONE]') return

      let payload: {
        choices?: Array<{ delta?: { content?: string | null } }>
        usage?: Record<string, unknown>
      }
      try {
        payload = JSON.parse(data) as typeof payload
      } catch {
        continue
      }

      const delta = payload.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        content += delta
        handlers.onDelta(delta)
      }
      if (payload.usage) usage = readUsage(payload)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) consumeEvent(part)
  }

  if (buffer.trim()) consumeEvent(buffer)

  return { content, usage, endpoint }
}
