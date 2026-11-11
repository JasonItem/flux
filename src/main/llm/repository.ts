import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type {
  LlmModel,
  LlmModelCreateInput,
  LlmModelUpdateInput,
  LlmProvider,
  LlmProviderCreateInput,
  LlmProviderUpdateInput,
  LlmUsageDayStat,
  LlmUsageModelStat,
  LlmUsageRecord,
  LlmUsageStats,
} from '../../shared/llm'

interface ProviderRow {
  id: string
  name: string
  base_url: string
  api_key: string
  enabled: number
  created_at: string
  updated_at: string
}

interface ModelRow {
  id: string
  provider_id: string
  provider_name: string
  name: string
  model_id: string
  enabled: number
  is_default: number
  created_at: string
  updated_at: string
}

interface UsageRow {
  id: string
  created_at: string
  provider_name: string
  model_name: string
  model_id: string
  endpoint: string
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  status: string
  error: string | null
}

export interface LlmResolvedModel {
  model: LlmModel
  provider: {
    id: string
    name: string
    baseUrl: string
    apiKey: string
    enabled: boolean
  }
}

export interface LlmUsageInsert {
  id?: string
  providerId: string | null
  providerName: string
  modelRowId: string | null
  modelName: string
  modelId: string
  endpoint: string
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  status: 'success' | 'error'
  error: string | null
}

function nowIso(): string {
  return new Date().toISOString()
}

function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '••••'
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`
}

function mapProvider(row: ProviderRow): LlmProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKeyMasked: maskApiKey(row.api_key),
    hasApiKey: row.api_key.trim().length > 0,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapModel(row: ModelRow): LlmModel {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    name: row.name,
    modelId: row.model_id,
    enabled: row.enabled === 1,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export interface LlmRepository {
  listProviders: () => LlmProvider[]
  createProvider: (input: LlmProviderCreateInput) => LlmProvider
  updateProvider: (input: LlmProviderUpdateInput) => LlmProvider
  deleteProvider: (id: string) => void
  listModels: () => LlmModel[]
  createModel: (input: LlmModelCreateInput) => LlmModel
  updateModel: (input: LlmModelUpdateInput) => LlmModel
  deleteModel: (id: string) => void
  setDefaultModel: (id: string) => LlmModel
  resolveModel: (modelId?: string) => LlmResolvedModel
  getProviderCredentials: (providerId: string) => {
    id: string
    name: string
    baseUrl: string
    apiKey: string
    enabled: boolean
  }
  insertUsage: (input: LlmUsageInsert) => void
  listUsage: (limit?: number) => LlmUsageRecord[]
  getUsageStats: (days?: number) => LlmUsageStats
}

export function createLlmRepository(db: Database.Database): LlmRepository {
  const selectProvider = db.prepare(
    `SELECT id, name, base_url, api_key, enabled, created_at, updated_at
     FROM llm_providers WHERE id = ?`,
  )

  const selectModelJoined = db.prepare(
    `SELECT m.id, m.provider_id, p.name AS provider_name, m.name, m.model_id,
            m.enabled, m.is_default, m.created_at, m.updated_at
     FROM llm_models m
     INNER JOIN llm_providers p ON p.id = m.provider_id
     WHERE m.id = ?`,
  )

  const clearDefaults = db.prepare(`UPDATE llm_models SET is_default = 0 WHERE is_default = 1`)

  const setDefault = db.prepare(
    `UPDATE llm_models SET is_default = 1, updated_at = @updatedAt WHERE id = @id`,
  )

  function requireProvider(id: string): ProviderRow {
    const row = selectProvider.get(id) as ProviderRow | undefined
    if (!row) throw new Error('渠道不存在')
    return row
  }

  function requireModel(id: string): ModelRow {
    const row = selectModelJoined.get(id) as ModelRow | undefined
    if (!row) throw new Error('模型不存在')
    return row
  }

  function getModel(id: string): LlmModel {
    return mapModel(requireModel(id))
  }

  return {
    listProviders: () => {
      const rows = db
        .prepare(
          `SELECT id, name, base_url, api_key, enabled, created_at, updated_at
           FROM llm_providers
           ORDER BY created_at ASC`,
        )
        .all() as ProviderRow[]
      return rows.map(mapProvider)
    },

    createProvider: (input) => {
      const name = input.name.trim()
      const baseUrl = normalizeBaseUrl(input.baseUrl)
      if (!name) throw new Error('渠道名称不能为空')
      if (!baseUrl) throw new Error('接口地址不能为空')

      const id = randomUUID()
      const stamp = nowIso()
      db.prepare(
        `INSERT INTO llm_providers (id, name, base_url, api_key, enabled, created_at, updated_at)
         VALUES (@id, @name, @baseUrl, @apiKey, @enabled, @createdAt, @updatedAt)`,
      ).run({
        id,
        name,
        baseUrl,
        apiKey: input.apiKey.trim(),
        enabled: input.enabled === false ? 0 : 1,
        createdAt: stamp,
        updatedAt: stamp,
      })
      return mapProvider(requireProvider(id))
    },

    updateProvider: (input) => {
      const current = requireProvider(input.id)
      const name = input.name !== undefined ? input.name.trim() : current.name
      const baseUrl =
        input.baseUrl !== undefined ? normalizeBaseUrl(input.baseUrl) : current.base_url
      if (!name) throw new Error('渠道名称不能为空')
      if (!baseUrl) throw new Error('接口地址不能为空')

      const apiKey =
        input.apiKey !== undefined && input.apiKey.trim().length > 0
          ? input.apiKey.trim()
          : current.api_key
      const enabled =
        input.enabled !== undefined ? (input.enabled ? 1 : 0) : current.enabled
      const stamp = nowIso()

      db.prepare(
        `UPDATE llm_providers
         SET name = @name, base_url = @baseUrl, api_key = @apiKey,
             enabled = @enabled, updated_at = @updatedAt
         WHERE id = @id`,
      ).run({
        id: input.id,
        name,
        baseUrl,
        apiKey,
        enabled,
        updatedAt: stamp,
      })
      return mapProvider(requireProvider(input.id))
    },

    deleteProvider: (id) => {
      requireProvider(id)
      db.prepare(`DELETE FROM llm_providers WHERE id = ?`).run(id)
    },

    listModels: () => {
      const rows = db
        .prepare(
          `SELECT m.id, m.provider_id, p.name AS provider_name, m.name, m.model_id,
                  m.enabled, m.is_default, m.created_at, m.updated_at
           FROM llm_models m
           INNER JOIN llm_providers p ON p.id = m.provider_id
           ORDER BY m.is_default DESC, m.created_at ASC`,
        )
        .all() as ModelRow[]
      return rows.map(mapModel)
    },

    createModel: (input) => {
      requireProvider(input.providerId)
      const name = input.name.trim()
      const modelId = input.modelId.trim()
      if (!name) throw new Error('模型名称不能为空')
      if (!modelId) throw new Error('模型 ID 不能为空')

      const id = randomUUID()
      const stamp = nowIso()
      const makeDefault = input.isDefault === true

      const insert = db.transaction(() => {
        if (makeDefault) clearDefaults.run()
        db.prepare(
          `INSERT INTO llm_models
           (id, provider_id, name, model_id, enabled, is_default, created_at, updated_at)
           VALUES (@id, @providerId, @name, @modelId, @enabled, @isDefault, @createdAt, @updatedAt)`,
        ).run({
          id,
          providerId: input.providerId,
          name,
          modelId,
          enabled: input.enabled === false ? 0 : 1,
          isDefault: makeDefault ? 1 : 0,
          createdAt: stamp,
          updatedAt: stamp,
        })
      })
      insert()
      return getModel(id)
    },

    updateModel: (input) => {
      const current = requireModel(input.id)
      if (input.providerId !== undefined) requireProvider(input.providerId)

      const name = input.name !== undefined ? input.name.trim() : current.name
      const modelId = input.modelId !== undefined ? input.modelId.trim() : current.model_id
      if (!name) throw new Error('模型名称不能为空')
      if (!modelId) throw new Error('模型 ID 不能为空')

      const stamp = nowIso()
      db.prepare(
        `UPDATE llm_models
         SET provider_id = @providerId, name = @name, model_id = @modelId,
             enabled = @enabled, updated_at = @updatedAt
         WHERE id = @id`,
      ).run({
        id: input.id,
        providerId: input.providerId ?? current.provider_id,
        name,
        modelId,
        enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : current.enabled,
        updatedAt: stamp,
      })
      return getModel(input.id)
    },

    deleteModel: (id) => {
      requireModel(id)
      db.prepare(`DELETE FROM llm_models WHERE id = ?`).run(id)
    },

    setDefaultModel: (id) => {
      requireModel(id)
      const stamp = nowIso()
      const apply = db.transaction(() => {
        clearDefaults.run()
        setDefault.run({ id, updatedAt: stamp })
      })
      apply()
      return getModel(id)
    },

    getProviderCredentials: (providerId) => {
      const provider = requireProvider(providerId)
      if (provider.enabled !== 1) throw new Error('该渠道已停用')
      if (!provider.api_key.trim()) throw new Error('该渠道尚未填写 API Key')
      return {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.base_url,
        apiKey: provider.api_key,
        enabled: true,
      }
    },

    resolveModel: (modelId) => {
      let row: ModelRow | undefined
      if (modelId) {
        row = selectModelJoined.get(modelId) as ModelRow | undefined
        if (!row) throw new Error('模型不存在')
      } else {
        row = db
          .prepare(
            `SELECT m.id, m.provider_id, p.name AS provider_name, m.name, m.model_id,
                    m.enabled, m.is_default, m.created_at, m.updated_at
             FROM llm_models m
             INNER JOIN llm_providers p ON p.id = m.provider_id
             WHERE m.is_default = 1
             LIMIT 1`,
          )
          .get() as ModelRow | undefined
        if (!row) throw new Error('还没有默认模型，请先在设置里配置并设为默认')
      }

      if (row.enabled !== 1) throw new Error('该模型已停用')

      const provider = requireProvider(row.provider_id)
      if (provider.enabled !== 1) throw new Error('该模型所属渠道已停用')
      if (!provider.api_key.trim()) throw new Error('该渠道尚未填写 API Key')

      return {
        model: mapModel(row),
        provider: {
          id: provider.id,
          name: provider.name,
          baseUrl: provider.base_url,
          apiKey: provider.api_key,
          enabled: true,
        },
      }
    },

    insertUsage: (input) => {
      db.prepare(
        `INSERT INTO llm_usage
         (id, created_at, provider_id, provider_name, model_row_id, model_name, model_id,
          endpoint, prompt_tokens, completion_tokens, total_tokens, status, error)
         VALUES
         (@id, @createdAt, @providerId, @providerName, @modelRowId, @modelName, @modelId,
          @endpoint, @promptTokens, @completionTokens, @totalTokens, @status, @error)`,
      ).run({
        id: input.id ?? randomUUID(),
        createdAt: nowIso(),
        providerId: input.providerId,
        providerName: input.providerName,
        modelRowId: input.modelRowId,
        modelName: input.modelName,
        modelId: input.modelId,
        endpoint: input.endpoint,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens: input.totalTokens,
        status: input.status,
        error: input.error,
      })
    },

    listUsage: (limit = 100) => {
      const safeLimit = Math.max(1, Math.min(500, Math.round(limit)))
      const rows = db
        .prepare(
          `SELECT id, created_at, provider_name, model_name, model_id, endpoint,
                  prompt_tokens, completion_tokens, total_tokens, status, error
           FROM llm_usage
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(safeLimit) as UsageRow[]

      return rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        providerName: row.provider_name,
        modelName: row.model_name,
        modelId: row.model_id,
        endpoint: row.endpoint,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        status: row.status === 'error' ? 'error' : 'success',
        error: row.error,
      }))
    },

    getUsageStats: (days = 14) => {
      const safeDays = Math.max(1, Math.min(90, Math.round(days)))
      const since = new Date()
      since.setHours(0, 0, 0, 0)
      since.setDate(since.getDate() - (safeDays - 1))
      const sinceIso = since.toISOString()

      const rows = db
        .prepare(
          `SELECT id, created_at, provider_name, model_name, model_id, endpoint,
                  prompt_tokens, completion_tokens, total_tokens, status, error
           FROM llm_usage
           WHERE created_at >= ?
           ORDER BY created_at ASC`,
        )
        .all(sinceIso) as UsageRow[]

      const localDayKey = (value: Date | string): string => {
        const date = value instanceof Date ? value : new Date(value)
        if (Number.isNaN(date.getTime())) {
          return typeof value === 'string' ? value.slice(0, 10) : ''
        }
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
      }

      const dayMap = new Map<string, LlmUsageDayStat>()
      for (let i = 0; i < safeDays; i += 1) {
        const day = new Date(since)
        day.setDate(since.getDate() + i)
        const key = localDayKey(day)
        dayMap.set(key, {
          date: key,
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        })
      }

      const modelMap = new Map<string, LlmUsageModelStat>()
      let successCount = 0
      let errorCount = 0

      for (const row of rows) {
        const key = localDayKey(row.created_at)
        const day = dayMap.get(key)
        if (day) {
          day.requests += 1
          day.promptTokens += row.prompt_tokens ?? 0
          day.completionTokens += row.completion_tokens ?? 0
          day.totalTokens += row.total_tokens ?? 0
        }

        if (row.status === 'error') errorCount += 1
        else successCount += 1

        const modelKey = `${row.model_id}::${row.model_name}`
        const current = modelMap.get(modelKey) ?? {
          modelName: row.model_name,
          modelId: row.model_id,
          requests: 0,
          totalTokens: 0,
        }
        current.requests += 1
        current.totalTokens += row.total_tokens ?? 0
        modelMap.set(modelKey, current)
      }

      const daysStats = [...dayMap.values()]
      const totals = daysStats.reduce(
        (acc, day) => {
          acc.requests += day.requests
          acc.promptTokens += day.promptTokens
          acc.completionTokens += day.completionTokens
          acc.totalTokens += day.totalTokens
          return acc
        },
        {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          successCount,
          errorCount,
        },
      )

      return {
        days: daysStats,
        byModel: [...modelMap.values()].sort((a, b) => b.totalTokens - a.totalTokens),
        totals,
      }
    },
  }
}
