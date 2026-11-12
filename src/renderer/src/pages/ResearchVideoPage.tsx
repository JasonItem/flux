import {
  Button,
  Empty,
  Flexbox,
  Tag,
  Text,
  toast,
} from '@lobehub/ui'
import { Section } from '@lobehub/ui/dashboard'
import { ArrowLeft, Copy, ExternalLink, PenLine, Play, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { researchDissectDedupeKey, type StudioJob } from '../../../shared/jobs'
import type {
  ResearchCommentItem,
  ResearchProgressEvent,
  ResearchStructureBlock,
  ResearchTranscriptCue,
  ResearchVideoDetail,
} from '../../../shared/research'
import { CommentThreadList } from '../components/CommentThreadList'
import { DouyinTitleLink, resolveDouyinVideoUrl } from '../components/DouyinTitleLink'
import { RingProgress } from '../components/RingProgress'
import { isAppMockMediaUrl, resolveMediaUrl } from '../mockMedia'
import { navigate, type AppPath } from '../routes'
import { getStudio } from '../studioApi'

function normalizeComments(
  list: ResearchCommentItem[] | undefined,
  prefix = 'c',
): ResearchCommentItem[] {
  return (list ?? []).map((item, index) => {
    const id = item.id || `${prefix}-${String(index)}`
    return {
      ...item,
      id,
      avatarUrl: item.avatarUrl ?? null,
      replies: normalizeComments(item.replies, id),
    }
  })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
}

function formatCount(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`
  return String(value)
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.max(0, Math.round(sec % 60))
  return `${String(m)}:${String(s).padStart(2, '0')}`
}

function isLocalPlayUrl(url: string | null | undefined): boolean {
  return Boolean(
    url &&
      (url.startsWith('http://127.0.0.1:') ||
        url.startsWith('http://localhost:') ||
        url.startsWith('flux-media://')),
  )
}

function cuesForBlock(
  cues: ResearchTranscriptCue[],
  block: ResearchStructureBlock | undefined,
  isLast = false,
): ResearchTranscriptCue[] {
  if (!block || cues.length === 0) return []
  // Half-open [start, end) by cue.startSec — same line won't repeat across blocks
  return cues.filter((cue) => {
    if (cue.startSec < block.startSec - 0.05) return false
    if (isLast) return cue.startSec <= block.endSec + 0.05
    return cue.startSec < block.endSec - 0.05
  })
}

function looksOffTopicAnalysis(analysis: string, segmentText: string, title: string): boolean {
  const a = analysis.replace(/\s+/g, '')
  if (!a) return true
  const titleCompact = title.replace(/\s+/g, '')
  if (titleCompact.length >= 8 && a.includes(titleCompact.slice(0, 16))) return true
  const seg = segmentText.replace(/\s+/g, '')
  if (!seg) return false
  const segChars = new Set(seg)
  let hit = 0
  for (const ch of a) {
    if (segChars.has(ch)) hit += 1
  }
  return hit < Math.min(8, Math.floor(segChars.size * 0.08))
}

function heuristicAnalysisFromCues(
  block: ResearchStructureBlock,
  segmentText: string,
): string {
  const quote = segmentText.slice(0, 48).trim()
  const q = quote ? `「${quote}${segmentText.length > 48 ? '…' : ''}」` : '本段口播'
  switch (block.purpose) {
    case '留人':
      return `${q}：用好奇/反差先卡住滑动，再抛出身份或经历信息，把人留到下一段。`
    case '共鸣':
      return `${q}：说出受众正在想的误判或痛点，建立“说的就是我”的认同，为后面方法铺垫。`
    case '讲点':
      return `${q}：展开方法/经历细节，信息密度上升，用具体经历代替空口号。`
    case '转化':
    case '互动':
      return `${q}：收束观点并引导关注/互动，把前面铺垫落成行动。`
    default:
      return `${q}：服务整片叙事中的「${block.purpose}」功能，推进下一信息点。`
  }
}

function analysisForBlock(
  block: ResearchStructureBlock | undefined,
  segmentCues: ResearchTranscriptCue[],
  title: string,
): string {
  if (!block) return ''
  const segmentText = segmentCues.map((cue) => cue.text.trim()).filter(Boolean).join(' ')
  const analysis = block.analysis?.trim() || ''
  if (analysis && !looksOffTopicAnalysis(analysis, segmentText, title)) return analysis
  if (segmentText) return heuristicAnalysisFromCues(block, segmentText)
  return ''
}

function phaseLabel(phase: ResearchProgressEvent['phase']): string {
  switch (phase) {
    case 'downloading':
      return '下载视频'
    case 'transcribing':
      return '语音转写'
    case 'analyzing':
      return '大模型分析'
    case 'ready':
      return '完成'
    case 'error':
      return '失败'
    default:
      return '处理中'
  }
}

export function ResearchVideoPage({ videoId }: { videoId: string }) {
  const [detail, setDetail] = useState<ResearchVideoDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeBlock, setActiveBlock] = useState(0)
  const [activeCue, setActiveCue] = useState(0)
  const [currentSec, setCurrentSec] = useState(0)
  const [playFailed, setPlayFailed] = useState(false)
  const [retryingPlay, setRetryingPlay] = useState(false)
  const [replicating, setReplicating] = useState(false)
  const [progress, setProgress] = useState<ResearchProgressEvent | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playRetryDone = useRef(false)

  useEffect(() => {
    const key = researchDissectDedupeKey(videoId)
    const finishedToastKeys = new Set<string>()

    const syncFromJobs = (
      list: StudioJob[],
      justFinished: { id: string; status: 'succeeded' | 'failed' | 'cancelled' }[] = [],
    ) => {
      const related = list.filter((job) => job.dedupeKey === key)
      const active = related.find((job) => job.status === 'queued' || job.status === 'running')
      if (active) {
        setProgress({
          videoId,
          phase:
            active.phase === 'deps'
              ? 'transcribing'
              : active.phase === 'downloading' ||
                  active.phase === 'transcribing' ||
                  active.phase === 'analyzing' ||
                  active.phase === 'ready' ||
                  active.phase === 'error'
                ? active.phase
                : 'pending',
          message: active.message,
          percent: active.percent ?? undefined,
        })
        return
      }

      // 无进行中任务：清掉横幅；仅在本视频任务刚结束时刷新详情
      setProgress(null)
      const finished = justFinished.find((item) => related.some((job) => job.id === item.id))
      if (!finished) return
      const toastKey = `${finished.id}:${finished.status}`
      if (finishedToastKeys.has(toastKey)) return
      finishedToastKeys.add(toastKey)
      void getStudio()
        .research.getVideo(videoId)
        .then((next) => {
          setDetail(next)
          // 任务中心已弹「任务完成」；详情页只在失败时补充错误
          if (finished.status === 'failed' && next.dissectError) {
            toast.error({ title: '拆解失败', description: next.dissectError })
          }
        })
        .catch(() => undefined)
    }

    const offResearch = getStudio().research.onProgress((event) => {
      if (event.videoId !== videoId) return
      setProgress(event)
    })
    const offJobs = getStudio().jobs.onChanged((event) => {
      syncFromJobs(event.jobs, event.justFinished)
    })
    void getStudio()
      .jobs.list()
      .then((list) => syncFromJobs(list))
      .catch(() => undefined)

    return () => {
      offResearch()
      offJobs()
    }
  }, [videoId])

  useEffect(() => {
    let active = true
    playRetryDone.current = false
    void (async () => {
      setLoading(true)
      setPlayFailed(false)
      try {
        const next = await getStudio().research.getVideo(videoId)
        if (!active) return
        setDetail(next)
        setLoading(false)
        setActiveBlock(0)
        setActiveCue(0)
        setCurrentSec(0)
        // 进度横幅只跟「进行中的 job」走，由 jobs 订阅同步
        void getStudio()
          .jobs.list()
          .then((list: StudioJob[]) => {
            if (!active) return
            const mine = list.find(
              (job) =>
                job.dedupeKey === researchDissectDedupeKey(videoId) &&
                (job.status === 'queued' || job.status === 'running'),
            )
            if (mine) {
              setProgress({
                videoId,
                phase: 'pending',
                message: mine.message,
                percent: mine.percent ?? undefined,
              })
            } else {
              setProgress(null)
            }
          })
          .catch(() => undefined)
        // 评论样本明显少于视频评论量时，后台静默补拉（不挡首屏、不弹 toast）
        if (
          next.awemeId &&
          next.fullTranscript &&
          next.commentCount > next.comments.length &&
          next.comments.length < 80
        ) {
          void getStudio()
            .research.refreshVideo(videoId)
            .then((updated) => {
              if (!active) return
              setDetail(updated)
            })
            .catch(() => undefined)
        }
        // 仅在无本地可播地址时补缓存（不 force，避免覆盖好文件）
        if (!isLocalPlayUrl(next.playUrl)) {
          void getStudio()
            .research.ensureLocalMedia(videoId)
            .then((local) => {
              if (!active) return
              setDetail((prev) => (prev ? { ...prev, ...local, playUrl: local.playUrl } : prev))
              setPlayFailed(false)
            })
            .catch((error) => {
              if (!active) return
              toast.error({
                title: '本地缓存失败',
                description: errorMessage(error),
              })
            })
        }
      } catch (error) {
        toast.error({ title: '加载失败', description: errorMessage(error) })
        if (active) setDetail(null)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [videoId])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setPlayFailed(false)
    playRetryDone.current = false
    try {
      const prevReady =
        detail?.status === 'ready' &&
        detail.dissectStatus === 'ready' &&
        Boolean(detail.fullTranscript)
      const needsRedissect =
        detail?.dissectStatus === 'error' || !detail?.fullTranscript?.trim()

      if (needsRedissect) {
        await getStudio().research.enqueueDissect(videoId, { force: true })
        const next = await getStudio().research.getVideo(videoId)
        setDetail(next)
        const jobs = await getStudio().jobs.list()
        const mine = jobs.find(
          (job) =>
            job.dedupeKey === researchDissectDedupeKey(videoId) &&
            (job.status === 'queued' || job.status === 'running'),
        )
        setProgress(
          mine
            ? {
                videoId,
                phase: 'pending',
                message: mine.message || '已重新加入拆解队列',
                percent: mine.percent ?? undefined,
              }
            : {
                videoId,
                phase: 'pending',
                message: '已重新加入拆解队列',
              },
        )
        toast.success({ title: '已重新加入拆解', description: '完成后会自动打开完整详情' })
        return
      }

      const next = await getStudio().research.refreshVideo(videoId)
      setDetail(next)
      if (prevReady || (next.status === 'ready' && next.dissectStatus === 'ready')) {
        setProgress(null)
        toast.success({
          title: '数据已更新',
          description: `赞 ${formatCount(next.diggCount)} · 评 ${formatCount(next.commentCount)} · 评论样本 ${String(next.comments.length)} 条`,
        })
        return
      }
      const jobs = await getStudio().jobs.list()
      const mine = jobs.find(
        (job) =>
          job.dedupeKey === researchDissectDedupeKey(videoId) &&
          (job.status === 'queued' || job.status === 'running'),
      )
      if (mine) {
        setProgress({
          videoId,
          phase: 'pending',
          message: mine.message || '已加入后台拆解',
          percent: mine.percent ?? undefined,
        })
        toast.success({ title: '已加入后台任务', description: '侧栏任务中心可查看进度' })
      } else {
        setProgress(null)
        toast.success({ title: '已刷新' })
      }
    } catch (error) {
      toast.error({ title: '刷新失败', description: errorMessage(error) })
      setProgress(null)
    } finally {
      setRefreshing(false)
    }
  }, [videoId, detail])

  const retryLocalPlay = useCallback(async () => {
    if (retryingPlay || playRetryDone.current) return
    playRetryDone.current = true
    setRetryingPlay(true)
    try {
      const next = await getStudio().research.ensureLocalMedia(videoId, { force: true })
      setDetail((prev) => (prev ? { ...prev, ...next, playUrl: next.playUrl } : prev))
      setPlayFailed(false)
    } catch (error) {
      setPlayFailed(true)
      toast.error({ title: '本地缓存失败', description: errorMessage(error) })
    } finally {
      setRetryingPlay(false)
    }
  }, [retryingPlay, videoId])

  const replicateScript = useCallback(async () => {
    if (!detail?.fullTranscript?.trim()) {
      toast.error({ title: '请先完成拆解', description: '需要原片转写与结构后再复刻' })
      return
    }
    setReplicating(true)
    try {
      const job = await getStudio().workshop.enqueueReplicate(videoId, { force: true })
      toast.success({
        title: '已加入复刻任务',
        description: '完成后可在创作工坊打开；也可从任务中心跳转',
      })
      if (job.href?.startsWith('/workshop/')) {
        window.setTimeout(() => {
          navigate(job.href as AppPath)
        }, 400)
      }
    } catch (error) {
      toast.error({ title: '复刻入队失败', description: errorMessage(error) })
    } finally {
      setReplicating(false)
    }
  }, [detail?.fullTranscript, videoId])

  const copyAllTranscript = useCallback(async () => {
    if (!detail) return
    const fromCues = (detail.transcriptCues ?? [])
      .map((cue) => `${formatTime(cue.startSec)} ${cue.text.trim()}`)
      .filter((line) => line.trim().length > 0)
      .join('\n')
    const text = fromCues || detail.fullTranscript?.trim() || ''
    if (!text) {
      toast.error({ title: '暂无可复制文案' })
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.success({ title: '已复制全部文案' })
    } catch {
      toast.error({ title: '复制失败', description: '请检查剪贴板权限' })
    }
  }, [detail])

  const durationSec = detail?.durationSec || 1
  const blocks = detail?.structureBlocks ?? []
  const cues = detail?.transcriptCues ?? []
  const playUrl = resolveMediaUrl(detail?.playUrl)
  const coverUrl = resolveMediaUrl(detail?.coverUrl) ?? detail?.coverUrl ?? null
  const externalUrl = resolveDouyinVideoUrl({
    profileUrl: detail?.profileUrl,
    awemeId: detail?.awemeId,
  })
  const canOpenExternal = Boolean(externalUrl) && !isAppMockMediaUrl(externalUrl)
  const showVideo = Boolean(playUrl) && !playFailed

  useEffect(() => {
    // 本地缓存就绪后清掉先前 CDN 失败态
    if (isLocalPlayUrl(playUrl)) {
      setPlayFailed(false)
      playRetryDone.current = false
    }
  }, [playUrl])

  const activeCues = useMemo(
    () => cuesForBlock(cues, blocks[activeBlock], activeBlock === blocks.length - 1),
    [cues, blocks, activeBlock],
  )

  const activeAnalysis = useMemo(
    () => analysisForBlock(blocks[activeBlock], activeCues, detail?.title || ''),
    [blocks, activeBlock, activeCues, detail?.title],
  )

  const normalizedComments = useMemo(
    () => normalizeComments(detail?.comments),
    [detail?.comments],
  )

  const seekTo = (sec: number) => {
    setCurrentSec(sec)
    const el = videoRef.current
    if (el && playUrl) {
      el.currentTime = sec
      void el.play().catch(() => undefined)
    }
  }

  const seekToBlock = (index: number) => {
    const block = blocks[index]
    if (!block) return
    setActiveBlock(index)
    seekTo(block.startSec)
  }

  const seekToCue = (index: number) => {
    const cue = cues[index]
    if (!cue) return
    setActiveCue(index)
    seekTo(cue.startSec)
  }

  const syncFromTime = (sec: number) => {
    setCurrentSec(sec)
    if (blocks.length > 0) {
      const found = blocks.findIndex((item) => sec >= item.startSec && sec < item.endSec)
      if (found >= 0 && found !== activeBlock) setActiveBlock(found)
      else if (found < 0 && sec >= (blocks.at(-1)?.endSec ?? 0)) {
        const last = blocks.length - 1
        if (last !== activeBlock) setActiveBlock(last)
      }
    }
    if (cues.length > 0) {
      const foundCue = cues.findIndex((item) => sec >= item.startSec && sec < item.endSec)
      if (foundCue >= 0 && foundCue !== activeCue) setActiveCue(foundCue)
      else if (foundCue < 0 && sec >= (cues.at(-1)?.endSec ?? 0)) {
        const last = cues.length - 1
        if (last !== activeCue) setActiveCue(last)
      }
    }
  }

  const dissectReady = Boolean(detail?.fullTranscript?.trim()) && detail?.dissectStatus === 'ready'
  const dissectFailed = detail?.dissectStatus === 'error'
  const waitingForDissect = Boolean(detail) && !dissectReady && !dissectFailed
  const gateOpen = loading || !detail || waitingForDissect

  const loadingMessage = progress?.message
    ? progress.message
    : waitingForDissect
      ? '已加入拆解队列，完成后才会打开完整详情'
      : progress
        ? '后台拆解进行中，完成后会自动更新本页'
        : '正在读取本地样本详情…'

  return (
    <div className="page">
      <div className="page-toolbar page-toolbar--spread">
        <Button
          icon={ArrowLeft}
          type="text"
          onClick={() => {
            navigate('/research')
          }}
        >
          返回样本拆解
        </Button>
        <Flexbox gap={4} horizontal wrap="wrap" style={{ alignItems: 'center' }}>
          <Button
            disabled={loading || !detail?.fullTranscript?.trim()}
            icon={PenLine}
            loading={replicating}
            type="primary"
            onClick={() => {
              void replicateScript()
            }}
          >
            复刻脚本
          </Button>
          <Button
            disabled={loading || !detail}
            icon={RefreshCw}
            loading={refreshing}
            type="text"
            onClick={() => {
              void refresh()
            }}
          >
            刷新
          </Button>
        </Flexbox>
      </div>

      {gateOpen ? (
        <div className="page-empty">
          {loading || waitingForDissect ? (
            <div className="research-loading">
              <RingProgress percent={progress?.percent ?? null} size={88} />
              <Text weight={600}>
                {progress
                  ? phaseLabel(progress.phase)
                  : waitingForDissect
                    ? '排队拆解中'
                    : '正在打开样本'}
              </Text>
              <Text type="secondary">{loadingMessage}</Text>
            </div>
          ) : (
            <Empty
              description="样本可能已被重新分析覆盖。"
              title="找不到该视频"
              action={
                <Button type="primary" onClick={() => navigate('/research')}>
                  返回列表
                </Button>
              }
            />
          )}
        </div>
      ) : dissectFailed && detail ? (
        <div className="page-empty">
          <Empty
            description={detail.dissectError || '下载、转写或分析过程出错，可重试拆解。'}
            title="拆解失败"
            action={
              <Flexbox gap={8} horizontal>
                <Button type="primary" loading={refreshing} onClick={() => void refresh()}>
                  重新拆解
                </Button>
                <Button type="text" onClick={() => navigate('/research')}>
                  返回列表
                </Button>
              </Flexbox>
            }
          />
        </div>
      ) : (
        <div className="page-stack">

          <div className="research-editor">
            <div className="research-editor__stage">
              <div className="research-editor__monitor">
                {showVideo ? (
                  <video
                    ref={videoRef}
                    className="research-editor__video"
                    controls
                    key={playUrl}
                    poster={coverUrl ?? undefined}
                    preload="metadata"
                    src={playUrl!}
                    onError={() => {
                      void retryLocalPlay()
                    }}
                    onTimeUpdate={(event) => {
                      syncFromTime(event.currentTarget.currentTime)
                    }}
                  />
                ) : (
                  <div className="research-editor__poster">
                    {coverUrl ? (
                      <img alt="" referrerPolicy="no-referrer" src={coverUrl} />
                    ) : (
                      <div className="research-editor__poster-empty">
                        <Play size={32} />
                      </div>
                    )}
                    <div className="research-editor__poster-actions">
                      <Text type="secondary">
                        {retryingPlay
                          ? '正在重新下载本地缓存…'
                          : playFailed
                            ? '本地播放失败，正在尝试重新缓存；也可打开抖音原页'
                            : '无本地缓存时可打开原页对照时间轴'}
                      </Text>
                      <Flexbox gap={8} horizontal wrap="wrap">
                        <Button
                          loading={retryingPlay}
                          size="small"
                          type="primary"
                          onClick={() => {
                            playRetryDone.current = false
                            void retryLocalPlay()
                          }}
                        >
                          重新下载播放
                        </Button>
                        {canOpenExternal && externalUrl ? (
                          <Button
                            icon={ExternalLink}
                            size="small"
                            type="text"
                            onClick={() => {
                              window.open(externalUrl, '_blank', 'noreferrer')
                            }}
                          >
                            打开抖音页面
                          </Button>
                        ) : null}
                      </Flexbox>
                    </div>
                  </div>
                )}
              </div>

              <div className="research-editor__meta">
                <Flexbox gap={8} horizontal style={{ alignItems: 'center' }} wrap="wrap">
                  <DouyinTitleLink
                    awemeId={detail.awemeId}
                    className="research-video-title-link--detail"
                    profileUrl={detail.profileUrl}
                    title={detail.title}
                  />
                  <Tag>{detail.videoType}</Tag>
                  {detail.mediaStatus === 'ready' || isLocalPlayUrl(playUrl) ? (
                    <Tag>本地可播</Tag>
                  ) : null}
                </Flexbox>
                <Text type="secondary">
                  {detail.authorNickname}
                  {detail.authorUniqueId ? ` · @${detail.authorUniqueId}` : ''}
                  {` · 选题 ${detail.topicTitle}`}
                </Text>
                <Text>
                  赞 {formatCount(detail.diggCount)} · 评 {formatCount(detail.commentCount)} · 转{' '}
                  {formatCount(detail.shareCount)} · 匹配 {String(detail.matchScore)} · 时长{' '}
                  {formatTime(detail.durationSec)}
                </Text>
                <Text>{detail.summary}</Text>
              </div>
            </div>

            <Section
              title="视频结构与文案"
              extra={
                <Button
                  disabled={!detail.fullTranscript && (detail.transcriptCues?.length ?? 0) === 0}
                  icon={Copy}
                  size="small"
                  type="text"
                  onClick={() => {
                    void copyAllTranscript()
                  }}
                >
                  复制全部文案
                </Button>
              }
            >
              <div className="research-frame-editor">
                <div className="research-frame-ruler">
                  <Text fontSize={12} type="secondary">
                    {formatTime(currentSec)} / {formatTime(durationSec)}
                  </Text>
                  <div className="research-frame-track">
                    {blocks.map((block, index) => {
                      const widthPct = Math.max(
                        4,
                        ((block.endSec - block.startSec) / durationSec) * 100,
                      )
                      return (
                        <button
                          key={`${block.startSec}-${block.title}`}
                          className={
                            index === activeBlock
                              ? 'research-frame-clip is-active'
                              : 'research-frame-clip'
                          }
                          style={{ flexGrow: widthPct, flexBasis: 0 }}
                          type="button"
                          onClick={() => {
                            seekToBlock(index)
                          }}
                        >
                          <span className="research-frame-clip__title">{block.title}</span>
                          <span className="research-frame-clip__meta">
                            {formatTime(block.startSec)}–{formatTime(block.endSec)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="research-structure-panel">
                  {blocks[activeBlock] ? (
                    <Flexbox gap={14}>
                      <Flexbox gap={8} horizontal wrap="wrap" style={{ alignItems: 'center' }}>
                        <Text weight={600} fontSize={16}>
                          {blocks[activeBlock]!.title}
                        </Text>
                        <Tag>{blocks[activeBlock]!.purpose}</Tag>
                        <Text type="secondary">
                          {formatTime(blocks[activeBlock]!.startSec)} –{' '}
                          {formatTime(blocks[activeBlock]!.endSec)}
                        </Text>
                      </Flexbox>

                      <div className="research-structure-block">
                        <Text type="secondary">原视频文案</Text>
                        {activeCues.length > 0 ? (
                          <div className="research-transcript-cues">
                            {activeCues.map((cue) => {
                              const globalIndex = cues.indexOf(cue)
                              return (
                                <button
                                  key={`${String(cue.startSec)}-${cue.text.slice(0, 12)}`}
                                  className={
                                    globalIndex === activeCue
                                      ? 'research-transcript-cue is-active'
                                      : 'research-transcript-cue'
                                  }
                                  type="button"
                                  onClick={() => {
                                    if (globalIndex >= 0) seekToCue(globalIndex)
                                    else seekTo(cue.startSec)
                                  }}
                                >
                                  <span className="research-transcript-cue__time">
                                    {formatTime(cue.startSec)}
                                  </span>
                                  <span>{cue.text}</span>
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <Text type="secondary">
                            {detail.fullTranscript
                              ? '该时间段暂无对齐转写，可点其它段落或刷新重分析。'
                              : '暂无转写原文'}
                          </Text>
                        )}
                        {blocks[activeBlock]?.keyLines &&
                        blocks[activeBlock]!.keyLines!.length > 0 ? (
                          <Flexbox gap={4} style={{ marginTop: 6 }}>
                            <Text type="secondary">关键原句</Text>
                            {blocks[activeBlock]!.keyLines!.map((line) => (
                              <Text key={line}>「{line}」</Text>
                            ))}
                          </Flexbox>
                        ) : null}
                      </div>

                      <div className="research-structure-block">
                        <Text type="secondary">逻辑分析（基于本段原文）</Text>
                        {activeAnalysis ? (
                          <Text>{activeAnalysis}</Text>
                        ) : (
                          <Text type="secondary">拆解完成后显示基于原文的段落分析</Text>
                        )}
                      </div>

                      <div className="research-structure-block">
                        <Text type="secondary">剪辑推断</Text>
                        <Text>
                          {blocks[activeBlock]!.editingStyle?.trim() ||
                            detail.editingStyle ||
                            '暂无该段剪辑说明'}
                        </Text>
                      </div>
                    </Flexbox>
                  ) : (
                    <Text type="secondary">暂无结构块（拆解完成后显示）</Text>
                  )}
                </div>
              </div>
            </Section>
          </div>

          <Section title="优质评论">
            <CommentThreadList
              comments={normalizedComments}
              totalCommentCount={detail.commentCount}
            />
          </Section>

          <Section title="可复用要点">
            <ul className="track-evidence-list">
              {detail.takeaways.map((item) => (
                <li key={item}>
                  <Text>{item}</Text>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </div>
  )
}
