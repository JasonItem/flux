import type { ResearchCommentItem, ResearchTranscriptCue } from '../../shared/research'

export interface ResearchSampleInput {
  awemeId: string
  title: string
  description: string
  authorNickname: string
  authorUniqueId: string | null
  coverUrl: string | null
  playUrl: string | null
  diggCount: number
  commentCount: number
  shareCount: number
  durationSec: number
  profileUrl: string
  matchHint?: number
  comments: ResearchCommentItem[]
  /** ASR 原文案（真实口播） */
  fullTranscript?: string
  transcriptCues?: ResearchTranscriptCue[]
}
