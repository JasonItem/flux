import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

import type { DatabaseStatus } from '../shared/api'
import { createLlmRepository, type LlmRepository } from './llm/repository'
import { migrations } from './migrations'
import { createTikHubRepository, type TikHubRepository } from './tikhub/repository'
import {
  createAccountAnalysisRepository,
  type AccountAnalysisRepository,
} from './accountAnalysis/repository'
import { createResearchRepository, type ResearchRepository } from './research/repository'
import { createTopicRepository, type TopicRepository } from './topic/repository'
import { createTrackRepository, type TrackRepository } from './track/repository'

interface MigrationRow {
  id: number
  name: string
}

export interface AppDatabase {
  status: () => DatabaseStatus
  sqlite: Database.Database
  llm: LlmRepository
  tikhub: TikHubRepository
  track: TrackRepository
  topic: TopicRepository
  research: ResearchRepository
  accountAnalysis: AccountAnalysisRepository
  close: () => void
}

export function openDatabase(filePath: string): AppDatabase {
  mkdirSync(dirname(filePath), { recursive: true })

  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `)

  const applied = new Set(readMigrations(db).map((row) => row.name))
  const pending = migrations.filter((migration) => !applied.has(migration.name))

  if (pending.length > 0) {
    const insert = db.prepare(
      'INSERT INTO schema_migrations (id, name, applied_at) VALUES (@id, @name, @appliedAt)',
    )
    const apply = db.transaction(() => {
      for (const migration of pending) {
        db.exec(migration.sql)
        insert.run({
          id: migration.id,
          name: migration.name,
          appliedAt: new Date().toISOString(),
        })
      }
    })
    apply()
  }

  return {
    status: () => {
      const rows = readMigrations(db)
      return {
        ready: true,
        path: filePath,
        schemaVersion: rows.reduce((max, row) => Math.max(max, row.id), 0),
        appliedMigrations: rows.map((row) => row.name),
      }
    },
    sqlite: db,
    llm: createLlmRepository(db),
    tikhub: createTikHubRepository(db),
    track: createTrackRepository(db),
    topic: createTopicRepository(db),
    research: createResearchRepository(db),
    accountAnalysis: createAccountAnalysisRepository(db),
    close: () => {
      db.close()
    },
  }
}

function readMigrations(db: Database.Database): MigrationRow[] {
  return db
    .prepare('SELECT id, name FROM schema_migrations ORDER BY id ASC')
    .all() as MigrationRow[]
}
