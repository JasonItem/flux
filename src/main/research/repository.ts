import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type {
  ResearchCommentItem,
  ResearchScriptSegment,
  ResearchStructureBlock,
  ResearchVideoDetail,
  ResearchVideoStatus,
  ResearchVideoSummary,
  ResearchVideoType,
} from '../../shared/research'
import type { ResearchVideoDraft } from './mockAnalyze'

interface VideoRow {
  id: string
  topic_id: string
  account_id: string
  aweme_id: string | null
  title: string
  author_nickname: string
  author_unique_id: string | null
  cover_url: string | null
  play_url: string | null
  digg_count: number
  comment_count: number
  share_count: number
  duration_sec: number
  video_type: string
  match_score: number
  status: string
  profile_url: string
  summary: string
  editing_style: string
  breakdown_json: string
  created_at: string
  updated_at: string
  topic_title?: string
}

interface BreakdownPayload {
  description: string
  scriptSegments: ResearchScriptSegment[]
  structureBlocks: ResearchStructureBlock[]
  comments: ResearchCommentItem[]
  takeaways: string[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function parseBreakdown(raw: string): BreakdownPayload {
  try {
    const parsed = JSON.parse(raw) as Partial<BreakdownPayload>
    return {
      description: typeof parsed.description === 'string' ? parsed.description : '',
      scriptSegments: Array.isArray(parsed.scriptSegments) ? parsed.scriptSegments : [],
      structureBlocks: Array.isArray(parsed.structureBlocks) ? parsed.structureBlocks : [],
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
    }
  } catch {
    return {
      description: '',
      scriptSegments: [],
      structureBlocks: [],
      comments: [],
      takeaways: [],
    }
  }
}

function douyinVideoUrl(awemeId: string | null, fallback: string): string {
  if (awemeId && awemeId.trim()) return `https://www.douyin.com/video/${awemeId.trim()}`
  return fallback
}

function mapSummary(row: VideoRow): ResearchVideoSummary {
  const awemeId = row.aweme_id?.trim() || null
  return {
    id: row.id,
    topicId: row.topic_id,
    topicTitle: row.topic_title || '',
    title: row.title,
    authorNickname: row.author_nickname,
    authorUniqueId: row.author_unique_id,
    awemeId,
    coverUrl: row.cover_url,
    playUrl: row.play_url ?? null,
    diggCount: row.digg_count,
    commentCount: row.comment_count,
    shareCount: row.share_count,
    durationSec: row.duration_sec,
    videoType: (row.video_type as ResearchVideoType) || '其他',
    matchScore: row.match_score,
    status: (row.status as ResearchVideoStatus) || 'pending',
    profileUrl: douyinVideoUrl(awemeId, row.profile_url),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDetail(row: VideoRow): ResearchVideoDetail {
  const breakdown = parseBreakdown(row.breakdown_json)
  return {
    ...mapSummary(row),
    summary: row.summary,
    editingStyle: row.editing_style,
    scriptSegments: breakdown.scriptSegments,
    structureBlocks: breakdown.structureBlocks,
    comments: breakdown.comments,
    takeaways: breakdown.takeaways,
  }
}

function breakdownJsonFromDraft(draft: ResearchVideoDraft): string {
  return JSON.stringify({
    description: draft.description ?? '',
    scriptSegments: draft.scriptSegments,
    structureBlocks: draft.structureBlocks,
    comments: draft.comments,
    takeaways: draft.takeaways,
  })
}

export interface ResearchRepository {
  listByTopic: (topicId: string) => ResearchVideoSummary[]
  replaceTopicVideos: (
    topicId: string,
    accountId: string,
    topicTitle: string,
    drafts: ResearchVideoDraft[],
    status?: ResearchVideoStatus,
  ) => ResearchVideoSummary[]
  getVideo: (id: string) => ResearchVideoDetail
  getVideoSource: (id: string) => {
    detail: ResearchVideoDetail
    awemeId: string | null
    description: string
  }
  saveVideoAnalysis: (id: string, draft: ResearchVideoDraft) => ResearchVideoDetail
  updateVideoMedia: (
    id: string,
    media: { coverUrl?: string | null; playUrl?: string | null; durationSec?: number },
  ) => ResearchVideoDetail
}

export function createResearchRepository(db: Database.Database): ResearchRepository {
  const selectJoined = db.prepare(
    `SELECT v.*, t.title AS topic_title
     FROM research_videos v
     LEFT JOIN topics t ON t.id = v.topic_id
     WHERE v.id = ?`,
  )

  return {
    listByTopic: (topicId) => {
      const rows = db
        .prepare(
          `SELECT v.*, t.title AS topic_title
           FROM research_videos v
           LEFT JOIN topics t ON t.id = v.topic_id
           WHERE v.topic_id = ?
           ORDER BY v.match_score DESC, v.updated_at DESC`,
        )
        .all(topicId) as VideoRow[]
      return rows.map(mapSummary)
    },

    replaceTopicVideos: (topicId, accountId, topicTitle, drafts, status = 'pending') => {
      const stamp = nowIso()
      const apply = db.transaction(() => {
        db.prepare(`DELETE FROM research_videos WHERE topic_id = ?`).run(topicId)
        const insert = db.prepare(
          `INSERT INTO research_videos
           (id, topic_id, account_id, aweme_id, title, author_nickname, author_unique_id, cover_url,
            play_url, digg_count, comment_count, share_count, duration_sec, video_type, match_score, status,
            profile_url, summary, editing_style, breakdown_json, created_at, updated_at)
           VALUES
           (@id, @topicId, @accountId, @awemeId, @title, @authorNickname, @authorUniqueId, @coverUrl,
            @playUrl, @diggCount, @commentCount, @shareCount, @durationSec, @videoType, @matchScore, @status,
            @profileUrl, @summary, @editingStyle, @breakdownJson, @createdAt, @updatedAt)`,
        )
        for (const draft of drafts) {
          insert.run({
            id: randomUUID(),
            topicId,
            accountId,
            awemeId: draft.awemeId ?? null,
            title: draft.title,
            authorNickname: draft.authorNickname,
            authorUniqueId: draft.authorUniqueId,
            coverUrl: draft.coverUrl ?? null,
            playUrl: draft.playUrl ?? null,
            diggCount: draft.diggCount,
            commentCount: draft.commentCount,
            shareCount: draft.shareCount,
            durationSec: draft.durationSec,
            videoType: draft.videoType,
            matchScore: draft.matchScore,
            status,
            profileUrl: draft.profileUrl,
            summary: draft.summary,
            editingStyle: draft.editingStyle,
            breakdownJson: breakdownJsonFromDraft(draft),
            createdAt: stamp,
            updatedAt: stamp,
          })
        }
      })
      apply()
      const rows = db
        .prepare(
          `SELECT v.*, t.title AS topic_title
           FROM research_videos v
           LEFT JOIN topics t ON t.id = v.topic_id
           WHERE v.topic_id = ?
           ORDER BY v.match_score DESC, v.updated_at DESC`,
        )
        .all(topicId) as VideoRow[]
      return rows.map((row) => ({
        ...mapSummary(row),
        topicTitle: row.topic_title || topicTitle,
      }))
    },

    getVideo: (id) => {
      const row = selectJoined.get(id) as VideoRow | undefined
      if (!row) throw new Error('样本视频不存在')
      return mapDetail(row)
    },

    getVideoSource: (id) => {
      const row = selectJoined.get(id) as VideoRow | undefined
      if (!row) throw new Error('样本视频不存在')
      const breakdown = parseBreakdown(row.breakdown_json)
      return {
        detail: mapDetail(row),
        awemeId: row.aweme_id,
        description: breakdown.description || row.title,
      }
    },

    saveVideoAnalysis: (id, draft) => {
      const stamp = nowIso()
      const result = db
        .prepare(
          `UPDATE research_videos
           SET title = @title,
               video_type = @videoType,
               match_score = @matchScore,
               status = 'ready',
               cover_url = COALESCE(@coverUrl, cover_url),
               play_url = COALESCE(@playUrl, play_url),
               duration_sec = CASE WHEN @durationSec > 0 THEN @durationSec ELSE duration_sec END,
               summary = @summary,
               editing_style = @editingStyle,
               breakdown_json = @breakdownJson,
               updated_at = @updatedAt
           WHERE id = @id`,
        )
        .run({
          id,
          title: draft.title,
          videoType: draft.videoType,
          matchScore: draft.matchScore,
          coverUrl: draft.coverUrl ?? null,
          playUrl: draft.playUrl ?? null,
          durationSec: draft.durationSec || 0,
          summary: draft.summary,
          editingStyle: draft.editingStyle,
          breakdownJson: breakdownJsonFromDraft(draft),
          updatedAt: stamp,
        })
      if (result.changes === 0) throw new Error('样本视频不存在')
      const row = selectJoined.get(id) as VideoRow | undefined
      if (!row) throw new Error('样本视频不存在')
      return mapDetail(row)
    },

    updateVideoMedia: (id, media) => {
      const stamp = nowIso()
      const result = db
        .prepare(
          `UPDATE research_videos
           SET cover_url = COALESCE(@coverUrl, cover_url),
               play_url = COALESCE(@playUrl, play_url),
               duration_sec = CASE WHEN @durationSec > 0 THEN @durationSec ELSE duration_sec END,
               updated_at = @updatedAt
           WHERE id = @id`,
        )
        .run({
          id,
          coverUrl: media.coverUrl ?? null,
          playUrl: media.playUrl ?? null,
          durationSec: media.durationSec ?? 0,
          updatedAt: stamp,
        })
      if (result.changes === 0) throw new Error('样本视频不存在')
      const row = selectJoined.get(id) as VideoRow | undefined
      if (!row) throw new Error('样本视频不存在')
      return mapDetail(row)
    },
  }
}
