import { copyFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { app, BrowserWindow, ipcMain, Menu, screen, session, shell } from 'electron'

import {
  CleanupChannels,
  DatabaseStatusChannel,
  LlmChannels,
  TikHubChannels,
  AccountAnalysisChannels,
  ResearchChannels,
  TopicChannels,
  TrackChannels,
  WindowChannels,
  type CleanupUsageKeepDays,
  type DatabaseStatus,
  type DouyinAccountPreview,
  type LlmChatInput,
  type LlmModelCreateInput,
  type LlmModelUpdateInput,
  type LlmProviderCreateInput,
  type LlmProviderUpdateInput,
  type TikHubSettingsUpdateInput,
  type TopicManualInput,
  type TopicUpdateInput,
} from '../shared/api'
import { openDatabase, type AppDatabase } from './db'
import { createCleanupService, type CleanupService } from './cleanup/service'
import { createLlmService, type LlmService } from './llm/service'
import { createTikHubService, type TikHubService } from './tikhub/service'
import {
  createAccountAnalysisService,
  type AccountAnalysisService,
} from './accountAnalysis/service'
import { createResearchService, type ResearchService } from './research/service'
import { createTopicService, type TopicService } from './topic/service'
import { createTrackService, type TrackService } from './track/service'

let database: AppDatabase | null = null
let cleanupService: CleanupService | null = null
let llmService: LlmService | null = null
let tikhubService: TikHubService | null = null
let trackService: TrackService | null = null
let topicService: TopicService | null = null
let researchService: ResearchService | null = null
let accountAnalysisService: AccountAnalysisService | null = null

function databaseFilePath(): string {
  return join(app.getPath('userData'), 'studio.sqlite')
}

/** 改名后 Electron userData 目录会变；从旧目录带回 studio.sqlite（仅当新库不存在或几乎为空） */
function migrateLegacyDatabaseIfNeeded(targetPath: string): void {
  if (existsSync(targetPath)) {
    try {
      if (statSync(targetPath).size > 8192) return
    } catch {
      return
    }
  }

  const roaming = dirname(app.getPath('userData'))
  const legacyNames = ['MediaRet', 'AI自媒体工作台']
  let best: { path: string; size: number } | null = null
  for (const name of legacyNames) {
    const candidate = join(roaming, name, 'studio.sqlite')
    if (!existsSync(candidate)) continue
    try {
      const size = statSync(candidate).size
      if (size <= 8192) continue
      if (!best || size > best.size) best = { path: candidate, size }
    } catch {
      // skip unreadable
    }
  }
  if (!best) return

  try {
    copyFileSync(best.path, targetPath)
    for (const suffix of ['-wal', '-shm'] as const) {
      const side = `${best.path}${suffix}`
      if (existsSync(side)) copyFileSync(side, `${targetPath}${suffix}`)
    }
    console.log(`[studio] migrated sqlite from ${best.path} -> ${targetPath}`)
  } catch (error) {
    console.error('[studio] legacy sqlite migrate failed', error)
  }
}

function failedStatus(error: unknown): DatabaseStatus {
  return {
    ready: false,
    path: databaseFilePath(),
    schemaVersion: 0,
    appliedMigrations: [],
    error: error instanceof Error ? error.message : '未知错误',
  }
}

function readStatus(): DatabaseStatus {
  if (!database) return failedStatus('数据库尚未打开')
  return database.status()
}

function requireDb(): AppDatabase {
  if (!database) throw new Error('数据库尚未打开')
  return database
}

function requireLlm(): LlmService {
  if (!llmService) throw new Error('大模型服务尚未就绪')
  return llmService
}

function requireTikHub(): TikHubService {
  if (!tikhubService) throw new Error('TikHub 服务尚未就绪')
  return tikhubService
}

function requireTrack(): TrackService {
  if (!trackService) throw new Error('赛道自测服务尚未就绪')
  return trackService
}

function requireTopic(): TopicService {
  if (!topicService) throw new Error('选题服务尚未就绪')
  return topicService
}

function requireResearch(): ResearchService {
  if (!researchService) throw new Error('样本拆解服务尚未就绪')
  return researchService
}

function requireAccountAnalysis(): AccountAnalysisService {
  if (!accountAnalysisService) throw new Error('账号分析服务尚未就绪')
  return accountAnalysisService
}

function requireCleanup(): CleanupService {
  if (!cleanupService) throw new Error('本地清理服务尚未就绪')
  return cleanupService
}

function cleanIpcErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : '操作失败'
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || '操作失败'
}

function wrapInvoke<Args extends unknown[], Result>(
  fn: (...args: Args) => Result | Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    try {
      return await fn(...args)
    } catch (error) {
      throw new Error(cleanIpcErrorMessage(error))
    }
  }
}

const normalBounds = new WeakMap<BrowserWindow, Electron.Rectangle>()

function isEffectivelyMaximized(target: BrowserWindow): boolean {
  if (target.isMaximized()) return true
  const bounds = target.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  return bounds.width >= area.width - 8 && bounds.height >= area.height - 8
}

function notifyMaximized(target: BrowserWindow): void {
  if (target.isDestroyed()) return
  target.webContents.send(WindowChannels.maximizedChanged, isEffectivelyMaximized(target))
}

function bindWindowControls(window: BrowserWindow): void {
  const notify = () => notifyMaximized(window)
  window.on('maximize', notify)
  window.on('unmaximize', notify)
}

function toggleMaximize(target: BrowserWindow): void {
  if (isEffectivelyMaximized(target)) {
    const previous = normalBounds.get(target)
    if (target.isMaximized()) target.unmaximize()
    if (previous) target.setBounds(previous)
    normalBounds.delete(target)
  } else {
    normalBounds.set(target, target.getBounds())
    target.maximize()
  }
  notifyMaximized(target)
}

function resolveAppIcon(): string {
  // 开发态：仓库 resources/；打包后：process.resourcesPath
  if (app.isPackaged) return join(process.resourcesPath, 'icon.png')
  return join(app.getAppPath(), 'resources', 'icon.png')
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    resizable: true,
    title: 'Flux',
    icon: resolveAppIcon(),
    autoHideMenuBar: true,
    backgroundColor: '#f4f4f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  bindWindowControls(window)

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.once('ready-to-show', () => {
    window.show()
  })
  // 打包后若页面加载异常，避免一直无窗口
  setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible()) window.show()
  }, 2500)

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
    return
  }

  void window.loadFile(join(__dirname, '../renderer/index.html')).catch((error) => {
    console.error('[studio] load renderer failed', error)
    if (!window.isDestroyed()) window.show()
  })
}

function registerLlmIpc(): void {
  ipcMain.handle(
    LlmChannels.listProviders,
    wrapInvoke(() => requireDb().llm.listProviders()),
  )
  ipcMain.handle(
    LlmChannels.createProvider,
    wrapInvoke((_event, input: LlmProviderCreateInput) => requireDb().llm.createProvider(input)),
  )
  ipcMain.handle(
    LlmChannels.updateProvider,
    wrapInvoke((_event, input: LlmProviderUpdateInput) => requireDb().llm.updateProvider(input)),
  )
  ipcMain.handle(
    LlmChannels.deleteProvider,
    wrapInvoke((_event, id: string) => {
      requireDb().llm.deleteProvider(id)
    }),
  )
  ipcMain.handle(
    LlmChannels.listModels,
    wrapInvoke(() => requireDb().llm.listModels()),
  )
  ipcMain.handle(
    LlmChannels.createModel,
    wrapInvoke((_event, input: LlmModelCreateInput) => requireDb().llm.createModel(input)),
  )
  ipcMain.handle(
    LlmChannels.updateModel,
    wrapInvoke((_event, input: LlmModelUpdateInput) => requireDb().llm.updateModel(input)),
  )
  ipcMain.handle(
    LlmChannels.deleteModel,
    wrapInvoke((_event, id: string) => {
      requireDb().llm.deleteModel(id)
    }),
  )
  ipcMain.handle(
    LlmChannels.setDefaultModel,
    wrapInvoke((_event, id: string) => requireDb().llm.setDefaultModel(id)),
  )
  ipcMain.handle(
    LlmChannels.listUsage,
    wrapInvoke((_event, limit?: number) => requireDb().llm.listUsage(limit)),
  )
  ipcMain.handle(
    LlmChannels.getUsageStats,
    wrapInvoke((_event, days?: number) => requireDb().llm.getUsageStats(days)),
  )
  ipcMain.handle(
    LlmChannels.listRemoteModels,
    wrapInvoke((_event, providerId: string) => requireLlm().listRemoteModels(providerId)),
  )
  ipcMain.handle(
    LlmChannels.chat,
    wrapInvoke((_event, input: LlmChatInput) => requireLlm().chat(input)),
  )
  ipcMain.handle(
    LlmChannels.chatStreamStart,
    wrapInvoke((event, input: LlmChatInput) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new Error('找不到窗口')
      return requireLlm().startStream(window, input)
    }),
  )
  ipcMain.handle(
    LlmChannels.chatStreamAbort,
    wrapInvoke((_event, requestId: string) => {
      requireLlm().abortStream(requestId)
    }),
  )
}

function registerTikHubIpc(): void {
  ipcMain.handle(
    TikHubChannels.getSettings,
    wrapInvoke(() => requireTikHub().getSettings()),
  )
  ipcMain.handle(
    TikHubChannels.updateSettings,
    wrapInvoke((_event, input: TikHubSettingsUpdateInput) =>
      requireTikHub().updateSettings(input),
    ),
  )
  ipcMain.handle(
    TikHubChannels.testConnection,
    wrapInvoke(() => requireTikHub().testConnection()),
  )
  ipcMain.handle(
    TikHubChannels.getBalance,
    wrapInvoke(() => requireTikHub().getBalance()),
  )
  ipcMain.handle(
    TikHubChannels.getUsage,
    wrapInvoke((_event, days?: number) => requireTikHub().getUsage(days)),
  )
  ipcMain.handle(
    TikHubChannels.listAccounts,
    wrapInvoke(() => requireTikHub().listAccounts()),
  )
  ipcMain.handle(
    TikHubChannels.resolveAccount,
    wrapInvoke((_event, input: string) => requireTikHub().resolveAccount(input)),
  )
  ipcMain.handle(
    TikHubChannels.bindAccount,
    wrapInvoke((_event, preview: DouyinAccountPreview) => requireTikHub().bindAccount(preview)),
  )
  ipcMain.handle(
    TikHubChannels.refreshAccount,
    wrapInvoke((_event, id: string) => requireTikHub().refreshAccount(id)),
  )
  ipcMain.handle(
    TikHubChannels.deleteAccount,
    wrapInvoke((_event, id: string) => {
      requireTikHub().deleteAccount(id)
    }),
  )
  ipcMain.handle(
    TikHubChannels.setActiveAccount,
    wrapInvoke((_event, id: string) => requireTikHub().setActiveAccount(id)),
  )
  ipcMain.handle(
    TikHubChannels.listAccountVideos,
    wrapInvoke(
      (_event, id: string, options?: { maxCursor?: string; count?: number }) =>
        requireTikHub().listAccountVideos(id, options),
    ),
  )
}

function registerTrackIpc(): void {
  ipcMain.handle(
    TrackChannels.listAssessments,
    wrapInvoke((_event, accountId?: string) => requireTrack().listAssessments(accountId)),
  )
  ipcMain.handle(
    TrackChannels.getAssessment,
    wrapInvoke((_event, id: string, options?: { enrich?: boolean }) =>
      requireTrack().getAssessment(id, options),
    ),
  )
  ipcMain.handle(
    TrackChannels.startAssessment,
    wrapInvoke((_event, accountId?: string) => requireTrack().startAssessment(accountId)),
  )
  ipcMain.handle(
    TrackChannels.deleteAssessment,
    wrapInvoke((_event, id: string) => {
      requireTrack().deleteAssessment(id)
    }),
  )
}

function registerTopicIpc(): void {
  ipcMain.handle(
    TopicChannels.listTopics,
    wrapInvoke((_event, accountId?: string) => requireTopic().listTopics(accountId)),
  )
  ipcMain.handle(
    TopicChannels.addFromTrack,
    wrapInvoke((_event, assessmentId: string, candidateId: string) =>
      requireTopic().addFromTrack(assessmentId, candidateId),
    ),
  )
  ipcMain.handle(
    TopicChannels.addManual,
    wrapInvoke((_event, input: TopicManualInput) => requireTopic().addManual(input)),
  )
  ipcMain.handle(
    TopicChannels.updateTopic,
    wrapInvoke((_event, input: TopicUpdateInput) => requireTopic().updateTopic(input)),
  )
  ipcMain.handle(
    TopicChannels.deleteTopic,
    wrapInvoke((_event, id: string) => {
      requireTopic().deleteTopic(id)
    }),
  )
}

function registerResearchIpc(): void {
  ipcMain.handle(
    ResearchChannels.listVideos,
    wrapInvoke((_event, topicId: string) => requireResearch().listVideos(topicId)),
  )
  ipcMain.handle(
    ResearchChannels.analyzeTopic,
    wrapInvoke((_event, topicId: string) => requireResearch().analyzeTopic(topicId)),
  )
  ipcMain.handle(
    ResearchChannels.getVideo,
    wrapInvoke((_event, id: string) => requireResearch().getVideo(id)),
  )
  ipcMain.handle(
    ResearchChannels.refreshVideo,
    wrapInvoke((_event, id: string) => requireResearch().refreshVideo(id)),
  )
  ipcMain.handle(
    ResearchChannels.enrichTopicMedia,
    wrapInvoke((_event, topicId: string) => requireResearch().enrichTopicMedia(topicId)),
  )
  ipcMain.handle(
    ResearchChannels.enrichVideoMedia,
    wrapInvoke((_event, id: string) => requireResearch().enrichVideoMedia(id)),
  )
}

function registerAccountAnalysisIpc(): void {
  ipcMain.handle(
    AccountAnalysisChannels.getAnalysis,
    wrapInvoke((_event, accountId: string) => requireAccountAnalysis().getAnalysis(accountId)),
  )
  ipcMain.handle(
    AccountAnalysisChannels.analyzeAccount,
    wrapInvoke((_event, accountId: string) =>
      requireAccountAnalysis().analyzeAccount(accountId),
    ),
  )
  ipcMain.handle(
    AccountAnalysisChannels.getVideoAnalysis,
    wrapInvoke((_event, accountId: string, awemeId: string) =>
      requireAccountAnalysis().getVideoAnalysis(accountId, awemeId),
    ),
  )
  ipcMain.handle(
    AccountAnalysisChannels.refreshVideoAnalysis,
    wrapInvoke((_event, accountId: string, awemeId: string) =>
      requireAccountAnalysis().refreshVideoAnalysis(accountId, awemeId),
    ),
  )
}

function registerCleanupIpc(): void {
  ipcMain.handle(
    CleanupChannels.getStatus,
    wrapInvoke(() => requireCleanup().getStatus()),
  )
  ipcMain.handle(
    CleanupChannels.clearElectronCache,
    wrapInvoke(() => requireCleanup().clearElectronCache()),
  )
  ipcMain.handle(
    CleanupChannels.clearUsageLogs,
    wrapInvoke((_event, keepDays: CleanupUsageKeepDays) =>
      requireCleanup().clearUsageLogs(keepDays),
    ),
  )
  ipcMain.handle(
    CleanupChannels.clearAnalysisCache,
    wrapInvoke(() => requireCleanup().clearAnalysisCache()),
  )
}

app.setName('Flux')

if (process.platform !== 'darwin') {
  Menu.setApplicationMenu(null)
}

void app.whenReady().then(() => {
  // 抖音/字节 CDN 播放常校验 Referer，补上才能让 <video> 拉到流
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        '*://*.zjcdn.com/*',
        '*://*.douyin.com/*',
        '*://*.douyinpic.com/*',
        '*://*.douyinvod.com/*',
        '*://*.bytecdn.cn/*',
        '*://*.byteimg.com/*',
        '*://*.ibyteimg.com/*',
        '*://*.tiktokcdn.com/*',
        '*://*.tiktokcdn-us.com/*',
      ],
    },
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      if (!headers.Referer && !headers.referer) {
        headers.Referer = 'https://www.douyin.com/'
      }
      callback({ requestHeaders: headers })
    },
  )

  try {
    const dbPath = databaseFilePath()
    migrateLegacyDatabaseIfNeeded(dbPath)
    database = openDatabase(dbPath)
    cleanupService = createCleanupService({
      db: database.sqlite,
      databasePath: dbPath,
      userDataPath: app.getPath('userData'),
      session: session.defaultSession,
    })
    llmService = createLlmService(database.llm)
    tikhubService = createTikHubService(database.tikhub)
    topicService = createTopicService(database.topic, database.track)
    trackService = createTrackService(
      database.track,
      tikhubService,
      database.topic,
      llmService,
    )
    researchService = createResearchService(
      database.research,
      database.topic,
      llmService,
      tikhubService,
    )
    accountAnalysisService = createAccountAnalysisService(
      database.accountAnalysis,
      tikhubService,
      database.track,
      llmService,
    )
    const status = database.status()
    console.log(
      `[studio] sqlite ready ${status.path} schema=${String(status.schemaVersion)} migrations=${status.appliedMigrations.join(',')}`,
    )
  } catch (error) {
    console.error('[studio] sqlite failed', error)
  }

  ipcMain.handle(DatabaseStatusChannel, () => {
    try {
      return readStatus()
    } catch (error) {
      return failedStatus(error)
    }
  })

  registerLlmIpc()
  registerTikHubIpc()
  registerTrackIpc()
  registerTopicIpc()
  registerResearchIpc()
  registerAccountAnalysisIpc()
  registerCleanupIpc()

  ipcMain.on(WindowChannels.minimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on(WindowChannels.toggleMaximize, (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target) return
    toggleMaximize(target)
  })

  ipcMain.on(WindowChannels.close, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(WindowChannels.isMaximized, (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    return target ? isEffectivelyMaximized(target) : false
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  database?.close()
  database = null
  cleanupService = null
  llmService = null
  tikhubService = null
  trackService = null
  topicService = null
  researchService = null
  accountAnalysisService = null
})
