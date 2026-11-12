import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type Database from 'better-sqlite3'
import { BrowserWindow, dialog } from 'electron'

import type {
  BackupExportResult,
  BackupImportResult,
  BackupStatus,
} from '../../shared/backup'

export interface BackupService {
  getStatus: () => BackupStatus
  exportDatabase: (browserWindow?: BrowserWindow | null) => Promise<BackupExportResult>
  importDatabase: (browserWindow?: BrowserWindow | null) => Promise<BackupImportResult>
}

function fileBytes(path: string): number {
  try {
    return existsSync(path) ? statSync(path).size : 0
  } catch {
    return 0
  }
}

function directoryBytes(root: string): number {
  if (!existsSync(root)) return 0
  let total = 0
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      try {
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        if (entry.isFile()) total += statSync(full).size
      } catch {
        // locked / vanished
      }
    }
  }
  return total
}

function stampForFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

function schemaVersionOf(db: Database.Database): number {
  try {
    const row = db
      .prepare('SELECT COALESCE(MAX(id), 0) AS version FROM schema_migrations')
      .get() as { version?: number } | undefined
    return Number(row?.version ?? 0)
  } catch {
    return 0
  }
}

function assertBackupDatabase(filePath: string): { schemaVersion: number; bytes: number } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DatabaseCtor = require('better-sqlite3') as typeof import('better-sqlite3')
  let probe: Database.Database | null = null
  try {
    probe = new DatabaseCtor(filePath, { readonly: true, fileMustExist: true })
    const hasMigrations = probe
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations' LIMIT 1",
      )
      .get() as { ok?: number } | undefined
    if (!hasMigrations?.ok) {
      throw new Error('不是有效的 Flux 备份库（缺少 schema_migrations）')
    }
    const version = schemaVersionOf(probe)
    if (version <= 0) {
      throw new Error('备份库尚未初始化，无法导入')
    }
    return { schemaVersion: version, bytes: fileBytes(filePath) }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Flux 备份')) throw error
    throw new Error(
      error instanceof Error
        ? `无法读取备份文件：${error.message}`
        : '无法读取备份文件',
    )
  } finally {
    try {
      probe?.close()
    } catch {
      // ignore
    }
  }
}

function removeSidecarFiles(databasePath: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const side = `${databasePath}${suffix}`
    try {
      if (existsSync(side)) unlinkSync(side)
    } catch {
      // ignore
    }
  }
}

export function createBackupService(input: {
  getDb: () => Database.Database
  closeDatabase: () => void
  reopenDatabase: () => void
  databasePath: string
  userDataPath: string
}): BackupService {
  const mediaPath = join(input.userDataPath, 'media')
  const whisperPath = join(input.userDataPath, 'models', 'whisper')

  return {
    getStatus: () => {
      const db = input.getDb()
      return {
        databasePath: input.databasePath,
        databaseBytes: fileBytes(input.databasePath) + fileBytes(`${input.databasePath}-wal`),
        schemaVersion: schemaVersionOf(db),
        mediaBytes: directoryBytes(mediaPath),
        whisperBytes: directoryBytes(whisperPath),
      }
    },

    exportDatabase: async (browserWindow) => {
      const defaultName = `Flux-backup-${stampForFilename()}.sqlite`
      const saveOptions = {
        title: '导出 Flux 数据备份',
        defaultPath: defaultName,
        filters: [
          { name: 'Flux 数据库备份', extensions: ['sqlite', 'fluxdb'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      }
      const result = browserWindow
        ? await dialog.showSaveDialog(browserWindow, saveOptions)
        : await dialog.showSaveDialog(saveOptions)
      if (result.canceled || !result.filePath) {
        return { canceled: true, path: null, bytes: 0 }
      }

      const dest = result.filePath
      mkdirSync(dirname(dest), { recursive: true })
      // Consistent snapshot even while WAL is active
      await input.getDb().backup(dest)
      return {
        canceled: false,
        path: dest,
        bytes: fileBytes(dest),
      }
    },

    importDatabase: async (browserWindow) => {
      const openOptions = {
        title: '导入 Flux 数据备份',
        properties: ['openFile' as const],
        filters: [
          { name: 'Flux 数据库备份', extensions: ['sqlite', 'fluxdb', 'db'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      }
      const result = browserWindow
        ? await dialog.showOpenDialog(browserWindow, openOptions)
        : await dialog.showOpenDialog(openOptions)
      if (result.canceled || !result.filePaths[0]) {
        return { canceled: true, path: null, relaunching: false }
      }

      const source = result.filePaths[0]
      if (source === input.databasePath) {
        throw new Error('不能导入当前正在使用的数据库文件')
      }
      assertBackupDatabase(source)

      // Close live connection before replacing files on disk
      input.closeDatabase()

      const target = input.databasePath
      const temp = join(dirname(target), `studio.import.${Date.now()}.sqlite`)
      try {
        copyFileSync(source, temp)
        removeSidecarFiles(target)
        try {
          if (existsSync(target)) unlinkSync(target)
        } catch {
          // Windows may still hold a handle briefly; overwrite via rename below
        }
        try {
          renameSync(temp, target)
        } catch {
          copyFileSync(temp, target)
          try {
            unlinkSync(temp)
          } catch {
            // ignore
          }
        }
        removeSidecarFiles(target)
      } catch (error) {
        try {
          if (existsSync(temp)) unlinkSync(temp)
        } catch {
          // ignore
        }
        // Always try to remount whatever DB is left so the app keeps working
        try {
          input.reopenDatabase()
        } catch {
          // ignore reopen failure; surface original error
        }
        throw new Error(
          error instanceof Error
            ? `导入失败：${error.message}。请完全退出应用后重试，或把备份文件命名为 studio.sqlite 手动放到 ${dirname(target)}`
            : '导入失败',
        )
      }

      // Remount in-process — avoid app.relaunch() (breaks electron-vite in dev → blank window)
      input.reopenDatabase()

      return {
        canceled: false,
        path: basename(source),
        relaunching: false,
      }
    },
  }
}
