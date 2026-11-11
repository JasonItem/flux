import { randomUUID } from 'node:crypto'

import type { BrowserWindow } from 'electron'

import type {
  LlmChatInput,
  LlmChatResult,
  LlmRemoteModel,
  LlmStreamEndEvent,
  LlmStreamErrorEvent,
  LlmStreamStartResult,
} from '../../shared/llm'
import { LlmChannels } from '../../shared/llm'
import type { LlmRepository } from './repository'
import { chatCompletion, chatCompletionStream, listRemoteModels } from './client'

export interface LlmService {
  chat: (input: LlmChatInput) => Promise<LlmChatResult>
  startStream: (sender: BrowserWindow, input: LlmChatInput) => Promise<LlmStreamStartResult>
  abortStream: (requestId: string) => void
  listRemoteModels: (providerId: string) => Promise<LlmRemoteModel[]>
}

export function createLlmService(repo: LlmRepository): LlmService {
  const controllers = new Map<string, AbortController>()

  const recordSuccess = (args: {
    requestId: string
    providerId: string
    providerName: string
    modelRowId: string
    modelName: string
    modelId: string
    endpoint: string
    usage: LlmChatResult['usage']
  }): void => {
    repo.insertUsage({
      id: args.requestId,
      providerId: args.providerId,
      providerName: args.providerName,
      modelRowId: args.modelRowId,
      modelName: args.modelName,
      modelId: args.modelId,
      endpoint: args.endpoint,
      promptTokens: args.usage.promptTokens,
      completionTokens: args.usage.completionTokens,
      totalTokens: args.usage.totalTokens,
      status: 'success',
      error: null,
    })
  }

  const recordError = (args: {
    requestId: string
    providerId: string | null
    providerName: string
    modelRowId: string | null
    modelName: string
    modelId: string
    endpoint: string
    error: string
  }): void => {
    repo.insertUsage({
      id: args.requestId,
      providerId: args.providerId,
      providerName: args.providerName,
      modelRowId: args.modelRowId,
      modelName: args.modelName,
      modelId: args.modelId,
      endpoint: args.endpoint,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      status: 'error',
      error: args.error,
    })
  }

  return {
    listRemoteModels: async (providerId) => {
      const provider = repo.getProviderCredentials(providerId)
      return listRemoteModels({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        hint: provider.name,
      })
    },

    chat: async (input) => {
      const requestId = randomUUID()
      let resolved
      try {
        resolved = repo.resolveModel(input.modelId)
      } catch (error) {
        const message = error instanceof Error ? error.message : '解析模型失败'
        recordError({
          requestId,
          providerId: null,
          providerName: '-',
          modelRowId: input.modelId ?? null,
          modelName: '-',
          modelId: '-',
          endpoint: 'chat/completions',
          error: message,
        })
        throw error
      }

      const { model, provider } = resolved
      try {
        const response = await chatCompletion({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: model.modelId,
          messages: input.messages,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
        })
        recordSuccess({
          requestId,
          providerId: provider.id,
          providerName: provider.name,
          modelRowId: model.id,
          modelName: model.name,
          modelId: model.modelId,
          endpoint: response.endpoint,
          usage: response.usage,
        })
        return {
          requestId,
          modelId: model.id,
          modelName: model.name,
          providerId: provider.id,
          providerName: provider.name,
          content: response.content,
          usage: response.usage,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '调用失败'
        recordError({
          requestId,
          providerId: provider.id,
          providerName: provider.name,
          modelRowId: model.id,
          modelName: model.name,
          modelId: model.modelId,
          endpoint: 'chat/completions',
          error: message,
        })
        throw error
      }
    },

    startStream: async (window, input) => {
      const requestId = randomUUID()
      const resolved = repo.resolveModel(input.modelId)
      const { model, provider } = resolved
      const controller = new AbortController()
      controllers.set(requestId, controller)

      const start: LlmStreamStartResult = {
        requestId,
        modelId: model.id,
        modelName: model.name,
        providerId: provider.id,
        providerName: provider.name,
      }

      void (async () => {
        try {
          const response = await chatCompletionStream(
            {
              baseUrl: provider.baseUrl,
              apiKey: provider.apiKey,
              model: model.modelId,
              messages: input.messages,
              temperature: input.temperature,
              maxTokens: input.maxTokens,
              signal: controller.signal,
            },
            {
              onDelta: (delta) => {
                if (window.isDestroyed()) return
                window.webContents.send(LlmChannels.chatStreamChunk, {
                  requestId,
                  delta,
                })
              },
            },
          )

          recordSuccess({
            requestId,
            providerId: provider.id,
            providerName: provider.name,
            modelRowId: model.id,
            modelName: model.name,
            modelId: model.modelId,
            endpoint: response.endpoint,
            usage: response.usage,
          })

          if (!window.isDestroyed()) {
            const endEvent: LlmStreamEndEvent = {
              requestId,
              content: response.content,
              usage: response.usage,
            }
            window.webContents.send(LlmChannels.chatStreamEnd, endEvent)
          }
        } catch (error) {
          const message =
            error instanceof Error && error.name === 'AbortError'
              ? '已取消'
              : error instanceof Error
                ? error.message
                : '流式调用失败'

          if (error instanceof Error && error.name !== 'AbortError') {
            recordError({
              requestId,
              providerId: provider.id,
              providerName: provider.name,
              modelRowId: model.id,
              modelName: model.name,
              modelId: model.modelId,
              endpoint: 'chat/completions',
              error: message,
            })
          }

          if (!window.isDestroyed()) {
            const errorEvent: LlmStreamErrorEvent = { requestId, message }
            window.webContents.send(LlmChannels.chatStreamError, errorEvent)
          }
        } finally {
          controllers.delete(requestId)
        }
      })()

      return start
    },

    abortStream: (requestId) => {
      const controller = controllers.get(requestId)
      if (!controller) return
      controller.abort()
      controllers.delete(requestId)
    },
  }
}
