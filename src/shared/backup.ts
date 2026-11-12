export const BackupChannels = {
  getStatus: 'backup:get-status',
  exportDatabase: 'backup:export-database',
  importDatabase: 'backup:import-database',
} as const

export interface BackupStatus {
  databasePath: string
  databaseBytes: number
  schemaVersion: number
  mediaBytes: number
  whisperBytes: number
}

export interface BackupExportResult {
  canceled: boolean
  path: string | null
  bytes: number
}

export interface BackupImportResult {
  canceled: boolean
  path: string | null
  relaunching: boolean
}

export interface BackupApi {
  getStatus: () => Promise<BackupStatus>
  exportDatabase: () => Promise<BackupExportResult>
  importDatabase: () => Promise<BackupImportResult>
}
