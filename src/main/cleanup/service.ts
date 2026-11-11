import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type Database from 'better-sqlite3'
import type { Session } from 'electron'

import type {
  CleanupActionResult,
  CleanupSizeItem,
  CleanupStatus,
  CleanupUsageKeepDays,
} from '../../shared/cleanup'

const ELECTRON_CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'ShaderCache',
  'GrShaderCache',
  'DawnWebGPUCache',
  'DawnGraphiteCache',
  'GPUPersistentCache',
] as const

export interface CleanupService {
  getStatus: () => CleanupStatus
  clearElectronCache: () => Promise<CleanupActionResult>
  clearUsageLogs: (keepDays: CleanupUsageKeepDays) => CleanupActionResult
  clearAnalysisCache: () => CleanupActionResult
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

function measureElectronCache(userDataPath: string): { bytes: number; items: CleanupSizeItem[] } {
  const items: CleanupSizeItem[] = []
  let bytes = 0
  for (const name of ELECTRON_CACHE_DIRS) {
    const size = directoryBytes(join(userDataPath, name))
    if (size <= 0 && !existsSync(join(userDataPath, name))) continue
    items.push({ key: name, label: name, bytes: size })
    bytes += size
  }
  return { bytes, items }
}

function safeRemoveDir(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 40 })
  } catch {
    // Chromium may keep some files locked while the app is running
  }
}

function fileBytes(path: string): number {
  try {
    return existsSync(path) ? statSync(path).size : 0
  } catch {
    return 0
  }
}

function videoAnalysesBytes(raw: string | null): { bytes: number; count: number } {
  if (!raw) return { bytes: 0, count: 0 }
  try {
    const parsed = JSON.parse(raw) as { videoAnalyses?: Record<string, unknown> }
    const map = parsed.videoAnalyses
    if (!map || typeof map !== 'object') return { bytes: 0, count: 0 }
    const count = Object.keys(map).length
    if (count === 0) return { bytes: 0, count: 0 }
    return { bytes: JSON.stringify(map).length, count }
  } catch {
    return { bytes: 0, count: 0 }
  }
}

function stripVideoAnalyses(raw: string | null): { next: string | null; freed: number } {
  if (!raw) return { next: raw, freed: 0 }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const before = videoAnalysesBytes(raw)
    if (before.count === 0) return { next: raw, freed: 0 }
    parsed.videoAnalyses = {}
    const next = JSON.stringify(parsed)
    return { next, freed: Math.max(0, raw.length - next.length) }
  } catch {
    return { next: raw, freed: 0 }
  }
}

function cutoffIso(keepDays: CleanupUsageKeepDays): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - keepDays)
  return date.toISOString()
}

export function createCleanupService(input: {
  db: Database.Database
  databasePath: string
  userDataPath: string
  session: Session
}): CleanupService {
  const { db, databasePath, userDataPath, session } = input

  function measureUsageLogs(): CleanupStatus['usageLogs'] {
    const tikhub = db
      .prepare(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(
                  LENGTH(id) + LENGTH(created_at) + LENGTH(path)
                  + LENGTH(CAST(ok AS TEXT))
                  + COALESCE(LENGTH(CAST(status_code AS TEXT)), 0)
                  + COALESCE(LENGTH(message), 0)
                ), 0) AS bytes,
                MIN(created_at) AS oldest
         FROM tikhub_usage`,
      )
      .get() as { rows: number; bytes: number; oldest: string | null }

    const llm = db
      .prepare(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(
                  LENGTH(id) + LENGTH(created_at) + LENGTH(provider_name) + LENGTH(model_name)
                  + LENGTH(model_id) + LENGTH(endpoint) + LENGTH(status)
                  + COALESCE(LENGTH(provider_id), 0) + COALESCE(LENGTH(model_row_id), 0)
                  + COALESCE(LENGTH(error), 0)
                ), 0) AS bytes,
                MIN(created_at) AS oldest
         FROM llm_usage`,
      )
      .get() as { rows: number; bytes: number; oldest: string | null }

    const oldestCandidates = [tikhub.oldest, llm.oldest].filter(Boolean) as string[]
    oldestCandidates.sort()

    return {
      bytes: Number(tikhub.bytes) + Number(llm.bytes),
      tikhubRows: Number(tikhub.rows),
      llmRows: Number(llm.rows),
      oldestAt: oldestCandidates[0] ?? null,
    }
  }

  function measureAnalysisCache(): CleanupStatus['analysisCache'] {
    const diagnosisRows = db
      .prepare(`SELECT diagnosis_json FROM account_analyses`)
      .all() as Array<{ diagnosis_json: string | null }>

    let videoAnalysisBytes = 0
    let videoAnalysisCount = 0
    for (const row of diagnosisRows) {
      const part = videoAnalysesBytes(row.diagnosis_json)
      videoAnalysisBytes += part.bytes
      videoAnalysisCount += part.count
    }

    const breakdown = db
      .prepare(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(CASE
                  WHEN breakdown_json IS NULL OR breakdown_json IN ('', '{}') THEN 0
                  ELSE LENGTH(breakdown_json)
                END), 0) AS bytes
         FROM research_videos`,
      )
      .get() as { rows: number; bytes: number }

    const raw = db
      .prepare(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(LENGTH(raw_json)), 0) AS bytes
         FROM douyin_accounts
         WHERE raw_json IS NOT NULL AND LENGTH(raw_json) > 0`,
      )
      .get() as { rows: number; bytes: number }

    const breakdownBytes = Number(breakdown.bytes)
    const rawJsonBytes = Number(raw.bytes)

    return {
      bytes: videoAnalysisBytes + breakdownBytes + rawJsonBytes,
      videoAnalysisBytes,
      breakdownBytes,
      rawJsonBytes,
      videoAnalysisCount,
      researchVideoCount: Number(breakdown.rows),
      accountRawCount: Number(raw.rows),
    }
  }

  function vacuum(): void {
    try {
      db.exec('VACUUM')
    } catch {
      // VACUUM may fail if other connections briefly hold locks
    }
  }

  return {
    getStatus: () => {
      const electronCache = measureElectronCache(userDataPath)
      return {
        databasePath,
        databaseBytes:
          fileBytes(databasePath) +
          fileBytes(`${databasePath}-wal`) +
          fileBytes(`${databasePath}-shm`),
        electronCache,
        usageLogs: measureUsageLogs(),
        analysisCache: measureAnalysisCache(),
      }
    },

    clearElectronCache: async () => {
      const before = measureElectronCache(userDataPath).bytes
      try {
        await session.clearCache()
      } catch {
        // ignore
      }
      try {
        await session.clearCodeCaches({ urls: [] })
      } catch {
        // older Electron / locked code cache
      }

      for (const name of ELECTRON_CACHE_DIRS) {
        safeRemoveDir(join(userDataPath, name))
      }

      const after = measureElectronCache(userDataPath).bytes
      const freedBytes = Math.max(0, before - after)
      return {
        freedBytes,
        detail:
          freedBytes > 0
            ? `已清理 Chromium 运行缓存（部分文件若被占用会在下次启动后继续释放）`
            : '缓存目录已尝试清理；若体积未变，请完全退出应用后再清一次',
      }
    },

    clearUsageLogs: (keepDays) => {
      const before = measureUsageLogs()
      const cutoff = cutoffIso(keepDays)
      const tikhub = db.prepare(`DELETE FROM tikhub_usage WHERE created_at < ?`).run(cutoff)
      const llm = db.prepare(`DELETE FROM llm_usage WHERE created_at < ?`).run(cutoff)
      vacuum()
      const after = measureUsageLogs()
      const removed = before.tikhubRows + before.llmRows - after.tikhubRows - after.llmRows
      return {
        freedBytes: Math.max(0, before.bytes - after.bytes),
        detail: `已删除 ${String(removed)} 条早于 ${String(keepDays)} 天的用量记录（TikHub ${String(tikhub.changes)} / 大模型 ${String(llm.changes)}）`,
      }
    },

    clearAnalysisCache: () => {
      const before = measureAnalysisCache()
      const stamp = new Date().toISOString()

      const rows = db
        .prepare(`SELECT id, diagnosis_json FROM account_analyses`)
        .all() as Array<{ id: string; diagnosis_json: string | null }>
      const updateDiagnosis = db.prepare(
        `UPDATE account_analyses SET diagnosis_json = @diagnosisJson, updated_at = @updatedAt WHERE id = @id`,
      )
      const clearDiagnoses = db.transaction(() => {
        for (const row of rows) {
          const stripped = stripVideoAnalyses(row.diagnosis_json)
          if (stripped.next === row.diagnosis_json) continue
          updateDiagnosis.run({
            id: row.id,
            diagnosisJson: stripped.next,
            updatedAt: stamp,
          })
        }
      })
      clearDiagnoses()

      const breakdown = db
        .prepare(
          `UPDATE research_videos
           SET breakdown_json = '{}', updated_at = ?
           WHERE breakdown_json IS NOT NULL AND breakdown_json NOT IN ('', '{}')`,
        )
        .run(stamp)

      const raw = db
        .prepare(
          `UPDATE douyin_accounts
           SET raw_json = NULL, updated_at = ?
           WHERE raw_json IS NOT NULL AND LENGTH(raw_json) > 0`,
        )
        .run(stamp)

      vacuum()
      const after = measureAnalysisCache()
      return {
        freedBytes: Math.max(0, before.bytes - after.bytes),
        detail: `已清空单视频分析缓存、样本拆解正文（${String(breakdown.changes)}）与账号原始 JSON（${String(raw.changes)}）；诊断摘要与作品列表保留`,
      }
    },
  }
}
