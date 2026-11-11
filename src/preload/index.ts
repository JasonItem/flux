import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import {
  AccountAnalysisChannels,
  CleanupChannels,
  DatabaseStatusChannel,
  LlmChannels,
  TikHubChannels,
  ResearchChannels,
  TopicChannels,
  TrackChannels,
  WindowChannels,
  WorkshopChannels,
  type CleanupUsageKeepDays,
  type DouyinAccountPreview,
  type LlmChatInput,
  type LlmModelCreateInput,
  type LlmModelUpdateInput,
  type LlmProviderCreateInput,
  type LlmProviderUpdateInput,
  type LlmStreamChunkEvent,
  type LlmStreamEndEvent,
  type LlmStreamErrorEvent,
  type LlmStreamHandlers,
  type StudioApi,
  type TikHubSettingsUpdateInput,
  type TopicManualInput,
  type TopicUpdateInput,
  type WorkshopProgressEvent,
  type WorkshopScriptUpdateInput,
} from '../shared/api'
import { JobChannels, type JobsChangedEvent } from '../shared/jobs'
import { MediaChannels, type MediaProgressEvent } from '../shared/media'
import type { ResearchProgressEvent } from '../shared/research'

const api: StudioApi = {
  getDatabaseStatus: () => ipcRenderer.invoke(DatabaseStatusChannel),
  window: {
    minimize: () => {
      ipcRenderer.send(WindowChannels.minimize)
    },
    toggleMaximize: () => {
      ipcRenderer.send(WindowChannels.toggleMaximize)
    },
    close: () => {
      ipcRenderer.send(WindowChannels.close)
    },
    isMaximized: () => ipcRenderer.invoke(WindowChannels.isMaximized),
    onMaximizedChange: (callback) => {
      const listener = (_event: IpcRendererEvent, maximized: boolean) => {
        callback(maximized)
      }
      ipcRenderer.on(WindowChannels.maximizedChanged, listener)
      return () => {
        ipcRenderer.removeListener(WindowChannels.maximizedChanged, listener)
      }
    },
  },
  llm: {
    listProviders: () => ipcRenderer.invoke(LlmChannels.listProviders),
    createProvider: (input: LlmProviderCreateInput) =>
      ipcRenderer.invoke(LlmChannels.createProvider, input),
    updateProvider: (input: LlmProviderUpdateInput) =>
      ipcRenderer.invoke(LlmChannels.updateProvider, input),
    deleteProvider: (id: string) => ipcRenderer.invoke(LlmChannels.deleteProvider, id),
    listModels: () => ipcRenderer.invoke(LlmChannels.listModels),
    createModel: (input: LlmModelCreateInput) => ipcRenderer.invoke(LlmChannels.createModel, input),
    updateModel: (input: LlmModelUpdateInput) => ipcRenderer.invoke(LlmChannels.updateModel, input),
    deleteModel: (id: string) => ipcRenderer.invoke(LlmChannels.deleteModel, id),
    setDefaultModel: (id: string) => ipcRenderer.invoke(LlmChannels.setDefaultModel, id),
    listUsage: (limit?: number) => ipcRenderer.invoke(LlmChannels.listUsage, limit),
    getUsageStats: (days?: number) => ipcRenderer.invoke(LlmChannels.getUsageStats, days),
    listRemoteModels: (providerId: string) =>
      ipcRenderer.invoke(LlmChannels.listRemoteModels, providerId),
    chat: (input: LlmChatInput) => ipcRenderer.invoke(LlmChannels.chat, input),
    chatStream: async (input: LlmChatInput, handlers: LlmStreamHandlers = {}) => {
      const start = await ipcRenderer.invoke(LlmChannels.chatStreamStart, input)

      const onChunk = (_event: IpcRendererEvent, payload: LlmStreamChunkEvent) => {
        if (payload.requestId !== start.requestId) return
        handlers.onChunk?.(payload)
      }
      const onEnd = (_event: IpcRendererEvent, payload: LlmStreamEndEvent) => {
        if (payload.requestId !== start.requestId) return
        cleanup()
        handlers.onDone?.(payload)
      }
      const onError = (_event: IpcRendererEvent, payload: LlmStreamErrorEvent) => {
        if (payload.requestId !== start.requestId) return
        cleanup()
        handlers.onError?.(payload)
      }

      const cleanup = () => {
        ipcRenderer.removeListener(LlmChannels.chatStreamChunk, onChunk)
        ipcRenderer.removeListener(LlmChannels.chatStreamEnd, onEnd)
        ipcRenderer.removeListener(LlmChannels.chatStreamError, onError)
      }

      ipcRenderer.on(LlmChannels.chatStreamChunk, onChunk)
      ipcRenderer.on(LlmChannels.chatStreamEnd, onEnd)
      ipcRenderer.on(LlmChannels.chatStreamError, onError)

      return start
    },
    abortStream: (requestId: string) => ipcRenderer.invoke(LlmChannels.chatStreamAbort, requestId),
  },
  tikhub: {
    getSettings: () => ipcRenderer.invoke(TikHubChannels.getSettings),
    updateSettings: (input: TikHubSettingsUpdateInput) =>
      ipcRenderer.invoke(TikHubChannels.updateSettings, input),
    testConnection: () => ipcRenderer.invoke(TikHubChannels.testConnection),
    getBalance: () => ipcRenderer.invoke(TikHubChannels.getBalance),
    getUsage: (days?: number) => ipcRenderer.invoke(TikHubChannels.getUsage, days),
    listAccounts: () => ipcRenderer.invoke(TikHubChannels.listAccounts),
    resolveAccount: (input: string) => ipcRenderer.invoke(TikHubChannels.resolveAccount, input),
    bindAccount: (preview: DouyinAccountPreview) =>
      ipcRenderer.invoke(TikHubChannels.bindAccount, preview),
    refreshAccount: (id: string) => ipcRenderer.invoke(TikHubChannels.refreshAccount, id),
    deleteAccount: (id: string) => ipcRenderer.invoke(TikHubChannels.deleteAccount, id),
    setActiveAccount: (id: string) => ipcRenderer.invoke(TikHubChannels.setActiveAccount, id),
    listAccountVideos: (id: string, options?: { maxCursor?: string; count?: number }) =>
      ipcRenderer.invoke(TikHubChannels.listAccountVideos, id, options),
  },
  track: {
    listAssessments: (accountId?: string) =>
      ipcRenderer.invoke(TrackChannels.listAssessments, accountId),
    getAssessment: (id: string, options?: { enrich?: boolean }) =>
      ipcRenderer.invoke(TrackChannels.getAssessment, id, options),
    startAssessment: (accountId?: string) =>
      ipcRenderer.invoke(TrackChannels.startAssessment, accountId),
    deleteAssessment: (id: string) => ipcRenderer.invoke(TrackChannels.deleteAssessment, id),
  },
  topic: {
    listTopics: (accountId?: string) => ipcRenderer.invoke(TopicChannels.listTopics, accountId),
    addFromTrack: (assessmentId: string, candidateId: string) =>
      ipcRenderer.invoke(TopicChannels.addFromTrack, assessmentId, candidateId),
    addManual: (input: TopicManualInput) => ipcRenderer.invoke(TopicChannels.addManual, input),
    updateTopic: (input: TopicUpdateInput) =>
      ipcRenderer.invoke(TopicChannels.updateTopic, input),
    deleteTopic: (id: string) => ipcRenderer.invoke(TopicChannels.deleteTopic, id),
  },
  research: {
    listVideos: (topicId: string) => ipcRenderer.invoke(ResearchChannels.listVideos, topicId),
    listDissectRecords: (query) =>
      ipcRenderer.invoke(ResearchChannels.listDissectRecords, query),
    listCustomVideos: () => ipcRenderer.invoke(ResearchChannels.listCustomVideos),
    analyzeTopic: (topicId: string) => ipcRenderer.invoke(ResearchChannels.analyzeTopic, topicId),
    getVideo: (id: string) => ipcRenderer.invoke(ResearchChannels.getVideo, id),
    refreshVideo: (id: string) => ipcRenderer.invoke(ResearchChannels.refreshVideo, id),
    enrichTopicMedia: (topicId: string) =>
      ipcRenderer.invoke(ResearchChannels.enrichTopicMedia, topicId),
    enrichVideoMedia: (id: string) => ipcRenderer.invoke(ResearchChannels.enrichVideoMedia, id),
    ensureLocalMedia: (id: string, options?: { force?: boolean }) =>
      ipcRenderer.invoke(ResearchChannels.ensureLocalMedia, id, options),
    enqueueDissect: (id: string, options?: { force?: boolean }) =>
      ipcRenderer.invoke(ResearchChannels.enqueueDissect, id, options),
    enqueueDissectByUrl: (input) =>
      ipcRenderer.invoke(ResearchChannels.enqueueDissectByUrl, input),
    onProgress: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: ResearchProgressEvent) => {
        callback(payload)
      }
      ipcRenderer.on(ResearchChannels.progress, listener)
      return () => {
        ipcRenderer.removeListener(ResearchChannels.progress, listener)
      }
    },
  },
  workshop: {
    listScripts: () => ipcRenderer.invoke(WorkshopChannels.listScripts),
    getScript: (id: string) => ipcRenderer.invoke(WorkshopChannels.getScript, id),
    updateScript: (input: WorkshopScriptUpdateInput) =>
      ipcRenderer.invoke(WorkshopChannels.updateScript, input),
    deleteScript: (id: string) => ipcRenderer.invoke(WorkshopChannels.deleteScript, id),
    enqueueReplicate: (researchVideoId: string, options?: { force?: boolean }) =>
      ipcRenderer.invoke(WorkshopChannels.enqueueReplicate, researchVideoId, options),
    onProgress: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: WorkshopProgressEvent) => {
        callback(payload)
      }
      ipcRenderer.on(WorkshopChannels.progress, listener)
      return () => {
        ipcRenderer.removeListener(WorkshopChannels.progress, listener)
      }
    },
  },
  jobs: {
    list: () => ipcRenderer.invoke(JobChannels.list),
    enqueue: (input) => ipcRenderer.invoke(JobChannels.enqueue, input),
    cancel: (id) => ipcRenderer.invoke(JobChannels.cancel, id),
    clearFinished: () => ipcRenderer.invoke(JobChannels.clearFinished),
    onChanged: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: JobsChangedEvent) => {
        callback(payload)
      }
      ipcRenderer.on(JobChannels.changed, listener)
      return () => {
        ipcRenderer.removeListener(JobChannels.changed, listener)
      }
    },
  },
  media: {
    ensureByAwemeId: (awemeId, options) =>
      ipcRenderer.invoke(MediaChannels.ensureByAwemeId, awemeId, options),
    ensureResearchVideo: (id, options) =>
      ipcRenderer.invoke(MediaChannels.ensureResearchVideo, id, options),
    getLocalPlayUrl: (awemeId) => ipcRenderer.invoke(MediaChannels.getLocalPlayUrl, awemeId),
    onProgress: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: MediaProgressEvent) => {
        callback(payload)
      }
      ipcRenderer.on(MediaChannels.progress, listener)
      return () => {
        ipcRenderer.removeListener(MediaChannels.progress, listener)
      }
    },
  },
  accountAnalysis: {
    getAnalysis: (accountId: string) =>
      ipcRenderer.invoke(AccountAnalysisChannels.getAnalysis, accountId),
    analyzeAccount: (accountId: string) =>
      ipcRenderer.invoke(AccountAnalysisChannels.analyzeAccount, accountId),
    getVideoAnalysis: (accountId: string, awemeId: string) =>
      ipcRenderer.invoke(AccountAnalysisChannels.getVideoAnalysis, accountId, awemeId),
    refreshVideoAnalysis: (accountId: string, awemeId: string) =>
      ipcRenderer.invoke(AccountAnalysisChannels.refreshVideoAnalysis, accountId, awemeId),
  },
  cleanup: {
    getStatus: () => ipcRenderer.invoke(CleanupChannels.getStatus),
    clearElectronCache: () => ipcRenderer.invoke(CleanupChannels.clearElectronCache),
    clearUsageLogs: (keepDays: CleanupUsageKeepDays) =>
      ipcRenderer.invoke(CleanupChannels.clearUsageLogs, keepDays),
    clearAnalysisCache: () => ipcRenderer.invoke(CleanupChannels.clearAnalysisCache),
    clearMediaCache: () => ipcRenderer.invoke(CleanupChannels.clearMediaCache),
  },
}

contextBridge.exposeInMainWorld('studio', api)
