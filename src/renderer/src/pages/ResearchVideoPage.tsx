import {
  Button,
  Empty,
  Flexbox,
  Spin,
  Tag,
  Text,
  toast,
} from '@lobehub/ui'
import { Section } from '@lobehub/ui/dashboard'
import { ArrowLeft, ExternalLink, Play, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  ResearchCommentItem,
  ResearchScriptSegment,
  ResearchStructureBlock,
  ResearchVideoDetail,
} from '../../../shared/research'
import { CommentThreadList } from '../components/CommentThreadList'
import { DouyinTitleLink, resolveDouyinVideoUrl } from '../components/DouyinTitleLink'
import { isAppMockMediaUrl, resolveMediaUrl } from '../mockMedia'
import { navigate } from '../routes'
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

function scriptForBlock(
  blocks: ResearchStructureBlock[],
  scripts: ResearchScriptSegment[],
  index: number,
): ResearchScriptSegment | null {
  if (scripts[index]) return scripts[index]!
  if (scripts.length === 0) return null
  const ratio = blocks.length <= 1 ? 0 : index / (blocks.length - 1)
  const mapped = Math.round(ratio * (scripts.length - 1))
  return scripts[mapped] ?? scripts[0] ?? null
}

export function ResearchVideoPage({ videoId }: { videoId: string }) {
  const [detail, setDetail] = useState<ResearchVideoDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeBlock, setActiveBlock] = useState(0)
  const [currentSec, setCurrentSec] = useState(0)
  const [playFailed, setPlayFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      setPlayFailed(false)
      try {
        // 已拆解会走本地缓存，只有首次 pending 才会请求接口
        const next = await getStudio().research.getVideo(videoId)
        if (active) {
          setDetail(next)
          setActiveBlock(0)
          setCurrentSec(0)
        }
      } catch (error) {
        toast.error({ title: '拆解视频失败', description: errorMessage(error) })
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
    try {
      const next = await getStudio().research.refreshVideo(videoId)
      setDetail(next)
      setActiveBlock(0)
      setCurrentSec(0)
      toast.success({ title: '已刷新拆解' })
    } catch (error) {
      toast.error({ title: '刷新失败', description: errorMessage(error) })
    } finally {
      setRefreshing(false)
    }
  }, [videoId])

  const durationSec = detail?.durationSec || 1
  const blocks = detail?.structureBlocks ?? []
  const scripts = detail?.scriptSegments ?? []
  const playUrl = resolveMediaUrl(detail?.playUrl)
  const coverUrl = resolveMediaUrl(detail?.coverUrl) ?? detail?.coverUrl ?? null
  const externalUrl = resolveDouyinVideoUrl({
    profileUrl: detail?.profileUrl,
    awemeId: detail?.awemeId,
  })
  const canOpenExternal = Boolean(externalUrl) && !isAppMockMediaUrl(externalUrl)
  const showVideo = Boolean(playUrl) && !playFailed

  const activeScript = useMemo(() => {
    if (!detail) return null
    return scriptForBlock(blocks, scripts, activeBlock)
  }, [detail, blocks, scripts, activeBlock])

  const seekToBlock = (index: number) => {
    const block = blocks[index]
    if (!block) return
    setActiveBlock(index)
    setCurrentSec(block.startSec)
    const el = videoRef.current
    if (el && playUrl) {
      el.currentTime = block.startSec
      void el.play().catch(() => undefined)
    }
  }

  const syncBlockFromTime = (sec: number) => {
    setCurrentSec(sec)
    if (blocks.length === 0) return
    const found = blocks.findIndex((item) => sec >= item.startSec && sec < item.endSec)
    if (found >= 0 && found !== activeBlock) setActiveBlock(found)
    else if (found < 0 && sec >= (blocks.at(-1)?.endSec ?? 0)) {
      const last = blocks.length - 1
      if (last !== activeBlock) setActiveBlock(last)
    }
  }

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
      </div>

      {loading || !detail ? (
        <div className="page-empty">
          {loading ? (
            <div className="research-loading">
              <Spin size="large" />
              <Text weight={600}>正在拆解样本</Text>
              <Text type="secondary">
                首次打开会补齐封面/播放地址，并拆解文案、结构与评论，通常需要几十秒…
              </Text>
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
                      poster={coverUrl ?? undefined}
                      src={playUrl!}
                      onError={() => {
                        setPlayFailed(true)
                      }}
                      onTimeUpdate={(event) => {
                        syncBlockFromTime(event.currentTarget.currentTime)
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
                          {playFailed
                            ? '直链已失效或受平台限制，请打开抖音原页观看'
                            : '无直链时可打开原页对照时间轴'}
                        </Text>
                        {canOpenExternal && externalUrl ? (
                          <Button
                            icon={ExternalLink}
                            size="small"
                            type="primary"
                            onClick={() => {
                              window.open(externalUrl, '_blank', 'noreferrer')
                            }}
                          >
                            打开抖音页面
                          </Button>
                        ) : null}
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
                desc="按时间块浏览结构；点选片段查看文案拆解与该段剪辑手法。有直链时会同步跳转播放进度。"
                title="视频结构"
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
                              {formatTime(block.startSec)}–{formatTime(block.endSec)} · {block.purpose}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="research-frame-inspect">
                    <div className="research-frame-inspect__block">
                      <Text type="secondary">结构片段</Text>
                      {blocks[activeBlock] ? (
                        <Flexbox gap={6}>
                          <Flexbox gap={8} horizontal wrap="wrap">
                            <Text weight={600}>{blocks[activeBlock]!.title}</Text>
                            <Tag>{blocks[activeBlock]!.purpose}</Tag>
                            <Text type="secondary">
                              {formatTime(blocks[activeBlock]!.startSec)} –{' '}
                              {formatTime(blocks[activeBlock]!.endSec)}
                            </Text>
                          </Flexbox>
                          <Text type="secondary">
                            留人 / 共鸣 / 讲点 / 转化：当前标注为「{blocks[activeBlock]!.purpose}」
                          </Text>
                        </Flexbox>
                      ) : (
                        <Text type="secondary">暂无结构块</Text>
                      )}
                    </div>

                    <div className="research-frame-inspect__block">
                      <Text type="secondary">本段剪辑风格</Text>
                      {blocks[activeBlock] ? (
                        <Text>
                          {blocks[activeBlock]!.editingStyle?.trim() ||
                            detail.editingStyle ||
                            '暂无该段剪辑说明，重新分析后可生成。'}
                        </Text>
                      ) : (
                        <Text type="secondary">暂无结构块</Text>
                      )}
                    </div>

                    <div className="research-frame-inspect__block">
                      <Text type="secondary">文案拆解</Text>
                      {activeScript ? (
                        <Flexbox gap={6}>
                          <Flexbox gap={8} horizontal wrap="wrap">
                            <Text weight={600}>{activeScript.label}</Text>
                            <Tag>{activeScript.purpose}</Tag>
                          </Flexbox>
                          <Text>{activeScript.text}</Text>
                        </Flexbox>
                      ) : (
                        <Text type="secondary">暂无文案段落</Text>
                      )}
                    </div>

                    {scripts.length > 0 ? (
                      <div className="research-frame-script-rail">
                        {scripts.map((item, index) => (
                          <button
                            key={`${item.label}-${String(index)}`}
                            className={
                              activeScript?.label === item.label && activeScript.text === item.text
                                ? 'research-frame-script-chip is-active'
                                : 'research-frame-script-chip'
                            }
                            type="button"
                            onClick={() => {
                              const mapped = Math.min(
                                blocks.length - 1,
                                Math.round((index / Math.max(scripts.length - 1, 1)) * (blocks.length - 1)),
                              )
                              seekToBlock(Math.max(0, mapped))
                            }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Section>
            </div>

            <Section
              desc="抖音式评论区：子评默认收起，区域内滚动加载；可按质量/点赞/回复/回复率排序。"
              title="优质评论"
            >
              <CommentThreadList comments={normalizeComments(detail.comments)} />
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
