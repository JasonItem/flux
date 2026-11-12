import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type {
  ResearchCommentItem,
  ResearchDissectRecordsQuery,
  ResearchDissectRecordsResult,
  ResearchDissectStatus,
  ResearchMediaStatus,
  ResearchScriptSegment,
  ResearchStructureBlock,
  ResearchTranscriptCue,
  ResearchVideoDetail,
  ResearchVideoStatus,
  ResearchVideoSummary,
  ResearchVideoType,
} from '../../shared/research'
import { localPlayUrlForAweme } from '../media/paths'
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
  local_path: string | null
  media_status: string | null
  dissect_status: string | null
  full_transcript: string | null
  transcript_cues_json: string | null
  dissect_error: string | null
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
  is_current?: number | null
  source?: string | null
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

function parseCues(raw: string | null): ResearchTranscriptCue[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const row = item as Record<string, unknown>
        const text = String(row.text ?? '').trim()
        if (!text) return null
        return {
          startSec: Math.max(0, Number(row.startSec) || 0),
          endSec: Math.max(0, Number(row.endSec) || 0),
          text,
        }
      })
      .filter((item): item is ResearchTranscriptCue => Boolean(item))
  } catch {
    return []
  }
}

function douyinVideoUrl(awemeId: string | null, fallback: string): string {
  if (awemeId && awemeId.trim()) return `https://www.douyin.com/video/${awemeId.trim()}`
  return fallback
}

function resolvePlayUrl(row: VideoRow): string | null {
  const awemeId = row.aweme_id?.trim()
  if (awemeId) {
    const local = localPlayUrlForAweme(awemeId)
    if (local) return local
  }
  const play = row.play_url ?? null
  // Legacy custom scheme / stale CDN — prefer nothing over broken CDN if we expect local
  if (play?.startsWith('http://127.0.0.1:') || play?.startsWith('flux-media://')) return play
  return play
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
    playUrl: resolvePlayUrl(row),
    localPath: row.local_path ?? null,
    mediaStatus: (row.media_status as ResearchMediaStatus) || 'none',
    dissectStatus: (row.dissect_status as ResearchDissectStatus) || 'pending',
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
    fullTranscript: row.full_transcript || '',
    transcriptCues: parseCues(row.transcript_cues_json),
    dissectError: row.dissect_error ?? null,
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
  listDissectRecords: (query?: ResearchDissectRecordsQuery) => ResearchDissectRecordsResult
  replaceTopicVideos: (
    topicId: string,
    accountId: string,
    topicTitle: string,
    drafts: ResearchVideoDraft[],
    status?: ResearchVideoStatus,
  ) => ResearchVideoSummary[]
  /** 按链接自定义添加/更新样本（不冲掉选题下其他样本） */
  upsertCustomVideo: (
    topicId: string,
    accountId: string,
    draft: ResearchVideoDraft,
    options?: { source?: 'custom' | 'radar'; isCurrent?: boolean },
  ) => ResearchVideoSummary
  /** 从样本/自定义列表撤出，仅保留拆解记录入口 */
  markVideoAsRecordOnly: (id: string) => ResearchVideoSummary
  listCustomVideos: (limit?: number) => ResearchVideoSummary[]
  findByAwemeId: (awemeId: string) => ResearchVideoSummary | null
  getVideo: (id: string) => ResearchVideoDetail
  getVideoSource: (id: string) => {
    detail: ResearchVideoDetail
    awemeId: string | null
    description: string
  }
  saveVideoAnalysis: (id: string, draft: ResearchVideoDraft) => ResearchVideoDetail
  updateVideoComments: (id: string, comments: ResearchCommentItem[]) => ResearchVideoDetail
  updateVideoStats: (
    id: string,
    stats: {
      diggCount?: number
      commentCount?: number
      shareCount?: number
      coverUrl?: string | null
      playUrl?: string | null
      durationSec?: number
      title?: string
    },
  ) => ResearchVideoDetail
  updateVideoMedia: (
    id: string,
    media: {
      coverUrl?: string | null
      playUrl?: string | null
      durationSec?: number
      localPath?: string | null
      mediaStatus?: ResearchMediaStatus
    },
  ) => ResearchVideoDetail
  updateDissectProgress: (
    id: string,
    patch: {
      dissectStatus?: ResearchDissectStatus
      dissectError?: string | null
      fullTranscript?: string
      transcriptCues?: ResearchTranscriptCue[]
      status?: ResearchVideoStatus
    },
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
           WHERE v.topic_id = ? AND IFNULL(v.is_current, 1) = 1
           ORDER BY v.match_score DESC, v.updated_at DESC`,
        )
        .all(topicId) as VideoRow[]
      return rows.map(mapSummary)
    },

    listDissectRecords: (query = {}) => {
      const pageSize = Math.min(50, Math.max(5, Math.round(query.pageSize ?? 10)))
      const page = Math.max(1, Math.round(query.page ?? 1))
      const topicId = query.topicId?.trim() || ''
      const where = topicId
        ? `WHERE v.dissect_status = 'ready'
             AND v.status = 'ready'
             AND IFNULL(v.full_transcript, '') != ''
             AND v.topic_id = @topicId`
        : `WHERE v.dissect_status = 'ready'
             AND v.status = 'ready'
             AND IFNULL(v.full_transcript, '') != ''`
      const totalRow = db
        .prepare(
          `SELECT COUNT(1) AS c
           FROM research_videos v
           ${where}`,
        )
        .get(topicId ? { topicId } : {}) as { c: number }
      const total = Number(totalRow?.c ?? 0)
      const offset = (page - 1) * pageSize
      const rows = db
        .prepare(
          `SELECT v.*, t.title AS topic_title
           FROM research_videos v
           LEFT JOIN topics t ON t.id = v.topic_id
           ${where}
           ORDER BY v.updated_at DESC
           LIMIT @limit OFFSET @offset`,
        )
        .all({
          ...(topicId ? { topicId } : {}),
          limit: pageSize,
          offset,
        }) as VideoRow[]
      return {
        items: rows.map(mapSummary),
        total,
        page,
        pageSize,
      }
    },

    replaceTopicVideos: (topicId, accountId, topicTitle, drafts, status = 'pending') => {
      const stamp = nowIso()
      const apply = db.transaction(() => {
        // Keep completed dissects as history (is_current=0); remove unfinished current samples
        db.prepare(
          `UPDATE research_videos
           SET is_current = 0, updated_at = @stamp
           WHERE topic_id = @topicId
             AND dissect_status = 'ready'
             AND status = 'ready'
             AND IFNULL(full_transcript, '') != ''`,
        ).run({ topicId, stamp })
        db.prepare(
          `DELETE FROM research_videos
           WHERE topic_id = ?
             AND IFNULL(is_current, 1) = 1`,
        ).run(topicId)
        const insert = db.prepare(
          `INSERT INTO research_videos
           (id, topic_id, account_id, aweme_id, title, author_nickname, author_unique_id, cover_url,
            play_url, local_path, media_status, dissect_status, full_transcript, transcript_cues_json, dissect_error,
            digg_count, comment_count, share_count, duration_sec, video_type, match_score, status,
            profile_url, summary, editing_style, breakdown_json, created_at, updated_at, is_current)
           VALUES
           (@id, @topicId, @accountId, @awemeId, @title, @authorNickname, @authorUniqueId, @coverUrl,
            @playUrl, NULL, 'none', 'pending', '', '[]', NULL,
            @diggCount, @commentCount, @shareCount, @durationSec, @videoType, @matchScore, @status,
            @profileUrl, @summary, @editingStyle, @breakdownJson, @createdAt, @updatedAt, 1)`,
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
           WHERE v.topic_id = ? AND IFNULL(v.is_current, 1) = 1
           ORDER BY v.match_score DESC, v.updated_at DESC`,
        )
        .all(topicId) as VideoRow[]
      return rows.map((row) => ({
        ...mapSummary(row),
        topicTitle: row.topic_title || topicTitle,
      }))
    },

    findByAwemeId: (awemeId) => {
      const id = awemeId.trim()
      if (!id) return null
      const row = db
        .prepare(
          `SELECT v.*, t.title AS topic_title
           FROM research_videos v
           LEFT JOIN topics t ON t.id = v.topic_id
           WHERE v.aweme_id = ?
           ORDER BY v.updated_at DESC
           LIMIT 1`,
        )
        .get(id) as VideoRow | undefined
      return row ? mapSummary(row) : null
    },

    listCustomVideos: (limit = 50) => {
      const size = Math.min(100, Math.max(5, Math.round(limit)))
      const rows = db
        .prepare(
          `SELECT v.*, t.title AS topic_title
           FROM research_videos v
           LEFT JOIN topics t ON t.id = v.topic_id
           WHERE IFNULL(v.source, 'sample') = 'custom'
           ORDER BY v.updated_at DESC
           LIMIT ?`,
        )
        .all(size) as VideoRow[]
      return rows.map(mapSummary)
    },

    upsertCustomVideo: (topicId, accountId, draft, options) => {
      const awemeId = draft.awemeId?.trim() || ''
      if (!awemeId) throw new Error('缺少 aweme_id')
      const stamp = nowIso()
      const source = options?.source === 'radar' ? 'radar' : 'custom'
      const isCurrent = options?.isCurrent == null ? 1 : options.isCurrent ? 1 : 0
      const existing = db
        .prepare(
          `SELECT v.*, t.title AS topic_title
           FROM research_videos v
           LEFT JOIN topics t ON t.id = v.topic_id
           WHERE v.aweme_id = ?
           ORDER BY v.updated_at DESC
           LIMIT 1`,
        )
        .get(awemeId) as VideoRow | undefined

      if (existing) {
        db.prepare(
          `UPDATE research_videos
           SET topic_id = @topicId,
               account_id = @accountId,
               title = @title,
               author_nickname = @authorNickname,
               author_unique_id = @authorUniqueId,
               cover_url = COALESCE(@coverUrl, cover_url),
               play_url = COALESCE(@playUrl, play_url),
               digg_count = @diggCount,
               comment_count = @commentCount,
               share_count = @shareCount,
               duration_sec = CASE WHEN @durationSec > 0 THEN @durationSec ELSE duration_sec END,
               video_type = @videoType,
               match_score = @matchScore,
               profile_url = @profileUrl,
               summary = CASE WHEN IFNULL(summary, '') = '' THEN @summary ELSE summary END,
               source = @source,
               is_current = @isCurrent,
               updated_at = @stamp
           WHERE id = @id`,
        ).run({
          id: existing.id,
          topicId,
          accountId,
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
          profileUrl: draft.profileUrl,
          summary: draft.summary || '自定义链接拆解',
          source,
          isCurrent,
          stamp,
        })
        return mapSummary({
          ...existing,
          ...(selectJoined.get(existing.id) as VideoRow),
        })
      }

      const id = randomUUID()
      db.prepare(
        `INSERT INTO research_videos
         (id, topic_id, account_id, aweme_id, title, author_nickname, author_unique_id, cover_url,
          play_url, local_path, media_status, dissect_status, full_transcript, transcript_cues_json, dissect_error,
          digg_count, comment_count, share_count, duration_sec, video_type, match_score, status,
          profile_url, summary, editing_style, breakdown_json, created_at, updated_at, is_current, source)
         VALUES
         (@id, @topicId, @accountId, @awemeId, @title, @authorNickname, @authorUniqueId, @coverUrl,
          @playUrl, NULL, 'none', 'pending', '', '[]', NULL,
          @diggCount, @commentCount, @shareCount, @durationSec, @videoType, @matchScore, 'pending',
          @profileUrl, @summary, '', @breakdownJson, @createdAt, @updatedAt, @isCurrent, @source)`,
      ).run({
        id,
        topicId,
        accountId,
        awemeId,
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
        profileUrl: draft.profileUrl,
        summary: draft.summary || '自定义链接拆解',
        breakdownJson: breakdownJsonFromDraft(draft),
        createdAt: stamp,
        updatedAt: stamp,
        isCurrent,
        source,
      })
      return mapSummary(selectJoined.get(id) as VideoRow)
    },

    markVideoAsRecordOnly: (id) => {
      const stamp = nowIso()
      const result = db
        .prepare(
          `UPDATE research_videos
           SET is_current = CASE
                 WHEN IFNULL(source, 'sample') IN ('custom', 'radar') THEN 0
                 ELSE is_current
               END,
               source = CASE
                 WHEN IFNULL(source, 'sample') IN ('custom', 'radar') THEN 'radar'
                 ELSE source
               END,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(stamp, id)
      if (result.changes === 0) throw new Error('样本不存在')
      return mapSummary(selectJoined.get(id) as VideoRow)
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
               dissect_status = 'ready',
               dissect_error = NULL,
               cover_url = COALESCE(@coverUrl, cover_url),
               play_url = COALESCE(@playUrl, play_url),
               duration_sec = CASE WHEN @durationSec > 0 THEN @durationSec ELSE duration_sec END,
               summary = @summary,
               editing_style = @editingStyle,
               full_transcript = COALESCE(@fullTranscript, full_transcript),
               transcript_cues_json = COALESCE(@transcriptCuesJson, transcript_cues_json),
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
          fullTranscript: draft.fullTranscript ?? null,
          transcriptCuesJson: draft.transcriptCues
            ? JSON.stringify(draft.transcriptCues)
            : null,
          breakdownJson: breakdownJsonFromDraft(draft),
          updatedAt: stamp,
        })
      if (result.changes === 0) throw new Error('样本视频不存在')
      const row = selectJoined.get(id) as VideoRow | undefined
      if (!row) throw new Error('样本视频不存在')
      return mapDetail(row)
    },

    updateVideoComments: (id, comments) => {
      const row = selectJoined.get(id) as VideoRow | undefined
      if (!row) throw new Error('样本视频不存在')
      const breakdown = parseBreakdown(row.breakdown_json)
      const stamp = nowIso()
      const result = db
        .prepare(
          `UPDATE research_videos
           SET breakdown_json = @breakdownJson,
               updated_at = @updatedAt
           WHERE id = @id`,
        )
        .run({
          id,
          breakdownJson: JSON.stringify({
            ...breakdown,
            comments,
          }),
          updatedAt: stamp,
        })
      if (result.changes === 0) throw new Error('样本视频不存在')
      const next = selectJoined.get(id) as VideoRow | undefined
      if (!next) throw new Error('样本视频不存在')
      return mapDetail(next)
    },

    updateVideoStats: (id, stats) => {
      const stamp = nowIso()
      const result = db
        .prepare(
          `UPDATE research_videos
           SET digg_count = COALESCE(@diggCount, digg_count),
               comment_count = COALESCE(@commentCount, comment_count),
               share_count = COALESCE(@shareCount, share_count),
               cover_url = COALESCE(@coverUrl, cover_url),
               play_url = COALESCE(@playUrl, play_url),
               duration_sec = CASE WHEN @durationSec > 0 THEN @durationSec ELSE duration_sec END,
               title = COALESCE(@title, title),
               updated_at = @updatedAt
           WHERE id = @id`,
        )
        .run({
          id,
          diggCount: stats.diggCount ?? null,
          commentCount: stats.commentCount ?? null,
          shareCount: stats.shareCount ?? null,
          coverUrl: stats.coverUrl ?? null,
          playUrl: stats.playUrl ?? null,
          durationSec: stats.durationSec ?? 0,
          title: stats.title?.trim() ? stats.title.trim() : null,
          updatedAt: stamp,
        })
      if (result.changes === 0) throw new Error('样本视频不存在')
      const next = selectJoined.get(id) as VideoRow | undefined
      if (!next) throw new Error('样本视频不存在')
      return mapDetail(next)
    },

    updateVideoMedia: (id, media) => {
      const stamp = nowIso()
      const result = db
        .prepare(
          `UPDATE research_videos
           SET cover_url = COALESCE(@coverUrl, cover_url),
               play_url = COALESCE(@playUrl, play_url),
               local_path = COALESCE(@localPath, local_path),
               media_status = COALESCE(@mediaStatus, media_status),
               duration_sec = CASE WHEN @durationSec > 0 THEN @durationSec ELSE duration_sec END,
               updated_at = @updatedAt
           WHERE id = @id`,
        )
        .run({
          id,
          coverUrl: media.coverUrl ?? null,
          playUrl: media.playUrl ?? null,
          localPath: media.localPath ?? null,
          mediaStatus: media.mediaStatus ?? null,
          durationSec: media.durationSec ?? 0,
          updatedAt: stamp,
        })
      if (result.changes === 0) throw new Error('样本视频不存在')
      const row = selectJoined.get(id) as VideoRow | undefined
      if (!row) throw new Error('样本视频不存在')
      return mapDetail(row)
    },

    updateDissectProgress: (id, patch) => {
      const stamp = nowIso()
      const result = db
        .prepare(
          `UPDATE research_videos
           SET dissect_status = COALESCE(@dissectStatus, dissect_status),
               dissect_error = CASE
                 WHEN @clearError = 1 THEN NULL
                 WHEN @dissectError IS NOT NULL THEN @dissectError
                 ELSE dissect_error
               END,
               full_transcript = COALESCE(@fullTranscript, full_transcript),
               transcript_cues_json = COALESCE(@transcriptCuesJson, transcript_cues_json),
               status = COALESCE(@status, status),
               updated_at = @updatedAt
           WHERE id = @id`,
        )
        .run({
          id,
          dissectStatus: patch.dissectStatus ?? null,
          dissectError: patch.dissectError ?? null,
          clearError: patch.dissectError === null ? 1 : 0,
          fullTranscript: patch.fullTranscript ?? null,
          transcriptCuesJson: patch.transcriptCues
            ? JSON.stringify(patch.transcriptCues)
            : null,
          status: patch.status ?? null,
          updatedAt: stamp,
        })
      if (result.changes === 0) throw new Error('样本视频不存在')
      const row = selectJoined.get(id) as VideoRow | undefined
      if (!row) throw new Error('样本视频不存在')
      return mapDetail(row)
    },
  }
}
