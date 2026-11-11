export const CleanupChannels = {
  getStatus: 'cleanup:get-status',
  clearElectronCache: 'cleanup:clear-electron-cache',
  clearUsageLogs: 'cleanup:clear-usage-logs',
  clearAnalysisCache: 'cleanup:clear-analysis-cache',
  clearMediaCache: 'cleanup:clear-media-cache',
} as const

export type CleanupUsageKeepDays = 30 | 90

export interface CleanupSizeItem {
  key: string
  label: string
  bytes: number
}

export interface CleanupStatus {
  databasePath: string
  databaseBytes: number
  electronCache: {
    bytes: number
    items: CleanupSizeItem[]
  }
  usageLogs: {
    bytes: number
    tikhubRows: number
    llmRows: number
    oldestAt: string | null
  }
  analysisCache: {
    bytes: number
    videoAnalysisBytes: number
    breakdownBytes: number
    rawJsonBytes: number
    videoAnalysisCount: number
    researchVideoCount: number
    accountRawCount: number
  }
  mediaCache: {
    bytes: number
    fileCount: number
    path: string
  }
}

export interface CleanupActionResult {
  freedBytes: number
  detail: string
}

export interface CleanupApi {
  getStatus: () => Promise<CleanupStatus>
  clearElectronCache: () => Promise<CleanupActionResult>
  clearUsageLogs: (keepDays: CleanupUsageKeepDays) => Promise<CleanupActionResult>
  clearAnalysisCache: () => Promise<CleanupActionResult>
  clearMediaCache: () => Promise<CleanupActionResult>
}
