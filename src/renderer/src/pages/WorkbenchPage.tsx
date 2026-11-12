import { AreaChart, BarList, CategoryBar } from '@lobehub/charts'
import { Button, Empty, Spin, Tag, Text, toast } from '@lobehub/ui'
import {
  CheckCircle2,
  CircleAlert,
  Clapperboard,
  FileSearch,
  Heart,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  MessageCircle,
  Share2,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { AccountAnalysisDetail } from '../../../shared/accountAnalysis'
import type { LlmUsageStats } from '../../../shared/llm'
import type { ResearchVideoSummary } from '../../../shared/research'
import type { DouyinAccount, TikHubUsageOverview } from '../../../shared/tikhub'
import type { TopicItem } from '../../../shared/topic'
import type { TrackAssessmentSummary } from '../../../shared/track'
import { DouyinTitleLink } from '../components/DouyinTitleLink'
import { VideoCoverThumb } from '../components/VideoCoverThumb'
import { accountVideoHref, navigate } from '../routes'
import { getLlmApi, getStudio } from '../studioApi'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

function formatCount(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`
  return String(value)
}

function countBy(items: string[]): { name: string; value: number }[] {
  const map = new Map<string, number>()
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
}

interface WorkbenchSnapshot {
  accounts: DouyinAccount[]
  activeAccount: DouyinAccount | null
  summaries: TrackAssessmentSummary[]
  topics: TopicItem[]
  videos: ResearchVideoSummary[]
  pendingVideos: number
  readyVideos: number
  analysis: AccountAnalysisDetail | null
  tikhubUsage: TikHubUsageOverview | null
  llmUsage: LlmUsageStats | null
  hasTikHubKey: boolean
  hasDefaultModel: boolean
}

export function WorkbenchPage() {
  const [loading, setLoading] = useState(true)
  const [snap, setSnap] = useState<WorkbenchSnapshot | null>(null)

  const load = useCallback(async () => {
    const studio = getStudio()
    const [accounts, topics, tikhub, models, tikhubUsage, llmUsage] = await Promise.all([
      studio.tikhub.listAccounts(),
      studio.topic.listTopics(),
      studio.tikhub.getSettings(),
      getLlmApi().listModels(),
      studio.tikhub.getUsage(14).catch(() => null),
      getLlmApi().getUsageStats(14).catch(() => null),
    ])

    const activeAccount = accounts.find((item) => item.isActive) ?? accounts[0] ?? null
    const [summaries, analysis] = await Promise.all([
      activeAccount ? studio.track.listAssessments(activeAccount.id) : Promise.resolve([]),
      activeAccount
        ? studio.accountAnalysis.getAnalysis(activeAccount.id).catch(() => null)
        : Promise.resolve(null),
    ])

    const validTopics = topics.filter((item) => Boolean(item.id) && Boolean(item.title))
    const videoLists = await Promise.all(
      validTopics.slice(0, 12).map((topic) => studio.research.listVideos(topic.id)),
    )
    const videos = videoLists.flat() as ResearchVideoSummary[]
    let pendingVideos = 0
    let readyVideos = 0
    for (const video of videos) {
      if (video.status === 'ready') readyVideos += 1
      else pendingVideos += 1
    }

    setSnap({
      accounts,
      activeAccount,
      summaries,
      topics: validTopics,
      videos,
      pendingVideos,
      readyVideos,
      analysis,
      tikhubUsage,
      llmUsage,
      hasTikHubKey: Boolean(tikhub.hasApiToken),
      hasDefaultModel: models.some((item) => item.isDefault),
    })
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      try {
        await load()
      } catch (error) {
        toast.error({ title: '读取工作台失败', description: errorMessage(error) })
        if (active) setSnap(null)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [load])

  const recentTopics = snap?.topics.slice(0, 4) ?? []
  const recentSummaries = snap?.summaries.slice(0, 3) ?? []
  const setupItems = useMemo(() => {
    if (!snap) return []
    return [
      {
        key: 'account',
        ok: snap.accounts.length > 0,
        label: '抖音账号',
        href: '/settings/accounts' as const,
      },
      {
        key: 'tikhub',
        ok: snap.hasTikHubKey,
        label: 'TikHub',
        href: '/settings/tikhub' as const,
      },
      {
        key: 'model',
        ok: snap.hasDefaultModel,
        label: '默认模型',
        href: '/settings/models' as const,
      },
    ]
  }, [snap])
  const pendingSetup = setupItems.filter((item) => !item.ok)
  const setupReady = pendingSetup.length === 0

  const sampleTypeData = useMemo(() => {
    if (!snap?.videos.length) return []
    return countBy(snap.videos.map((item) => item.videoType)).slice(0, 6)
  }, [snap])

  const accountPerfData = useMemo(() => {
    const videos = snap?.analysis?.videos ?? []
    if (videos.length === 0) return []
    const labels = { high: '高', mid: '中', low: '低' } as const
    return countBy(videos.map((item) => labels[item.performanceTag]))
  }, [snap])

  const accountTypeData = useMemo(() => {
    const videos = snap?.analysis?.videos ?? []
    if (videos.length === 0) return []
    return countBy(videos.map((item) => item.videoType)).slice(0, 5)
  }, [snap])

  const tikhubTrend = useMemo(() => {
    const series = snap?.tikhubUsage?.series ?? []
    if (!series.some((item) => item.requests > 0)) return []
    return series.map((item) => {
      const parts = item.date.split('-')
      const label = parts.length >= 3 ? `${parts[1]}/${parts[2]}` : item.date.slice(5)
      return {
        date: label,
        成功: item.successCount,
        失败: item.errorCount,
      }
    })
  }, [snap])

  const topVideos = useMemo(() => {
    const videos = [...(snap?.analysis?.videos ?? [])]
    return videos
      .sort((a, b) => b.relativeScore - a.relativeScore || b.estimatedPlay - a.estimatedPlay)
      .slice(0, 3)
  }, [snap])

  const sampleTotal = (snap?.pendingVideos ?? 0) + (snap?.readyVideos ?? 0)
  const sampleReadyShare =
    sampleTotal > 0 ? Math.round(((snap?.readyVideos ?? 0) / sampleTotal) * 100) : 0
  const hasPrimary =
    recentTopics.length > 0 || recentSummaries.length > 0 || topVideos.length > 0
  const hasSide =
    sampleTotal > 0 ||
    sampleTypeData.length > 0 ||
    accountPerfData.length > 0 ||
    accountTypeData.length > 0 ||
    tikhubTrend.length > 0
  const hasActivity = hasPrimary || hasSide

  if (loading) {
    return (
      <div className="page">
        <div className="page-empty">
          <div className="research-loading">
            <Spin size="large" />
            <Text weight={600}>正在汇总工作台</Text>
            <Text type="secondary">读取选题、样本、账号分析与用量…</Text>
          </div>
        </div>
      </div>
    )
  }

  if (!snap) {
    return (
      <div className="page">
        <div className="page-empty">
          <div className="research-loading">
            <Text weight={600}>暂时读不到本地数据</Text>
            <Text type="secondary">可稍后重试，或先检查账号与设置是否就绪。</Text>
            <Button type="primary" onClick={() => void load()}>
              重新加载
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="workbench">
        <div className="workbench-kpis">
          {(
            [
              { label: '选题', value: String(snap.topics.length), icon: Lightbulb },
              { label: '自测', value: String(snap.summaries.length), icon: Target },
              { label: '待拆解', value: String(snap.pendingVideos), icon: FileSearch },
              { label: '已拆解', value: String(snap.readyVideos), icon: ListChecks },
              {
                label: '近作',
                value: snap.analysis?.videos.length ? String(snap.analysis.videos.length) : '—',
                icon: Clapperboard,
              },
              {
                label: '粉丝',
                value:
                  snap.activeAccount?.followerCount == null
                    ? '—'
                    : formatCount(snap.activeAccount.followerCount),
                icon: Users,
              },
            ] as const satisfies ReadonlyArray<{
              label: string
              value: string
              icon: LucideIcon
            }>
          ).map((item) => {
            const Icon = item.icon
            return (
              <div key={item.label} className="workbench-kpi">
                <span className="workbench-kpi__icon" aria-hidden>
                  <Icon size={16} strokeWidth={2} />
                </span>
                <div className="workbench-kpi__copy">
                  <span className="workbench-kpi__label">{item.label}</span>
                  <span className="workbench-kpi__value">{item.value}</span>
                </div>
              </div>
            )
          })}
        </div>

        {!setupReady ? (
          <div className="workbench-setup">
            {setupItems.map((item) => (
              <button
                key={item.key}
                className={`workbench-setup__item${item.ok ? ' is-ok' : ''}`}
                type="button"
                onClick={() => {
                  if (!item.ok) navigate(item.href)
                }}
              >
                {item.ok ? (
                  <CheckCircle2 aria-hidden size={15} className="workbench-ok" />
                ) : (
                  <CircleAlert aria-hidden size={15} className="workbench-warn" />
                )}
                <span className="workbench-setup__label">{item.label}</span>
                <Tag>{item.ok ? '就绪' : '去配置'}</Tag>
              </button>
            ))}
          </div>
        ) : null}

        {hasActivity ? (
          <div className="workbench-main">
            <div className="workbench-main__primary">
              {hasPrimary ? (
                <>
                  {recentTopics.length > 0 ? (
                    <section className="workbench-feed">
                      <div className="workbench-feed__head">
                        <Text weight={600}>最近选题</Text>
                        <Button size="small" type="text" onClick={() => navigate('/research')}>
                          全部
                        </Button>
                      </div>
                      <div className="workbench-feed__list">
                        {recentTopics.map((topic) => (
                          <button
                            key={topic.id}
                            className="workbench-feed__row"
                            type="button"
                            onClick={() => navigate('/research')}
                          >
                            <span className="workbench-feed__title">{topic.title}</span>
                            <span className="workbench-feed__meta">
                              {formatTime(topic.updatedAt)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {recentSummaries.length > 0 ? (
                    <section className="workbench-feed">
                      <div className="workbench-feed__head">
                        <Text weight={600}>最近自测</Text>
                        <Button size="small" type="text" onClick={() => navigate('/track')}>
                          全部
                        </Button>
                      </div>
                      <div className="workbench-feed__list">
                        {recentSummaries.map((row) => (
                          <button
                            key={row.id}
                            className="workbench-feed__row"
                            type="button"
                            onClick={() => navigate('/track')}
                          >
                            <span className="workbench-feed__title">
                              {formatTime(row.createdAt)}
                              <span className="workbench-feed__sub">
                                {row.candidateCount} 个候选赛道
                              </span>
                            </span>
                            <Tag>
                              {row.status === 'ready'
                                ? '已完成'
                                : row.status === 'running'
                                  ? '进行中'
                                  : row.status === 'failed'
                                    ? '失败'
                                    : row.status}
                            </Tag>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {topVideos.length > 0 ? (
                    <section className="workbench-feed">
                      <div className="workbench-feed__head">
                        <Text weight={600}>近作相对高分</Text>
                        <Button size="small" type="text" onClick={() => navigate('/accounts')}>
                          账号分析
                        </Button>
                      </div>
                      <div className="workbench-feed__list">
                        {topVideos.map((row) => {
                          const openVideo = () => {
                            if (snap.activeAccount?.id) {
                              navigate(accountVideoHref(snap.activeAccount.id, row.awemeId))
                              return
                            }
                            navigate('/accounts')
                          }
                          return (
                            <div key={row.awemeId} className="workbench-video-card">
                              <VideoCoverThumb
                                coverUrl={row.coverUrl}
                                title={row.title || '无标题作品'}
                                onPlay={openVideo}
                              />
                              <div className="workbench-video-card__body">
                                <DouyinTitleLink
                                  awemeId={row.awemeId}
                                  className="workbench-video-card__title"
                                  profileUrl={row.profileUrl}
                                  title={row.title || '无标题作品'}
                                />
                                <div className="workbench-video-card__stats">
                                  <span>
                                    <Heart size={12} aria-hidden />
                                    {formatCount(row.diggCount)}
                                  </span>
                                  <span>
                                    <MessageCircle size={12} aria-hidden />
                                    {formatCount(row.commentCount)}
                                  </span>
                                  <span>
                                    <Share2 size={12} aria-hidden />
                                    {formatCount(row.shareCount)}
                                  </span>
                                  <span className="workbench-video-card__type">
                                    {row.videoType} · 估播 {formatCount(row.estimatedPlay)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  ) : null}
                </>
              ) : (
                <div className="workbench-primary-empty">
                  <Empty
                    description="去赛道自测生成细分赛道，或添加选题后再做样本拆解。"
                    icon={LayoutDashboard}
                    title="左侧还没有动态"
                    action={
                      <Button type="primary" onClick={() => navigate('/track')}>
                        赛道自测
                      </Button>
                    }
                  />
                </div>
              )}
            </div>

            <aside className="workbench-main__side">
              {sampleTotal > 0 ? (
                <section className="workbench-section">
                  <div className="workbench-section__head">
                    <Text weight={600}>样本进度</Text>
                    <Text type="secondary">{sampleReadyShare}% 已拆</Text>
                  </div>
                  <CategoryBar
                    showLabels
                    size={10}
                    valueFormatter={(value) => `${String(value)}`}
                    values={[snap.pendingVideos, snap.readyVideos]}
                  />
                  <Text className="workbench-section__hint" type="secondary">
                    待拆解 {String(snap.pendingVideos)} · 已拆解 {String(snap.readyVideos)}
                  </Text>
                </section>
              ) : null}

              {sampleTypeData.length > 0 ? (
                <section className="workbench-section">
                  <div className="workbench-section__head">
                    <Text weight={600}>样本类型</Text>
                  </div>
                  <BarList
                    data={sampleTypeData}
                    sortOrder="descending"
                    valueFormatter={(value) => String(value)}
                  />
                </section>
              ) : null}

              {accountPerfData.length > 0 ? (
                <section className="workbench-section">
                  <div className="workbench-section__head">
                    <Text weight={600}>近作表现</Text>
                  </div>
                  <div className="workbench-chips">
                    {accountPerfData.map((item) => (
                      <span key={item.name} className="workbench-chip">
                        {item.name}表现 <strong>{item.value}</strong>
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {accountTypeData.length > 0 ? (
                <section className="workbench-section">
                  <div className="workbench-section__head">
                    <Text weight={600}>近作类型</Text>
                  </div>
                  <BarList
                    data={accountTypeData}
                    sortOrder="descending"
                    valueFormatter={(value) => String(value)}
                  />
                </section>
              ) : null}

              {tikhubTrend.length > 0 ? (
                <section className="workbench-section">
                  <div className="workbench-section__head">
                    <Text weight={600}>TikHub 近 14 天</Text>
                    <Text type="secondary">
                      {String(snap.tikhubUsage?.totals.requests ?? 0)} 次
                    </Text>
                  </div>
                  <AreaChart
                    categories={['成功', '失败']}
                    data={tikhubTrend}
                    height={140}
                    index="date"
                    showGradient
                    stack
                    valueFormatter={(value) => `${String(value)} 次`}
                  />
                </section>
              ) : null}
            </aside>
          </div>
        ) : (
          <div className="page-empty workbench-blank">
            <Empty
              description={
                setupReady
                  ? '去赛道自测生成细分赛道，添加选题后再做样本拆解。'
                  : '先完成上方配置，再去做赛道自测和样本拆解。'
              }
              icon={LayoutDashboard}
              title="工作台还是空的"
              action={
                <div className="workbench-panel__actions">
                  {setupReady ? (
                    <>
                      <Button type="primary" onClick={() => navigate('/track')}>
                        赛道自测
                      </Button>
                      <Button onClick={() => navigate('/research')}>样本拆解</Button>
                    </>
                  ) : (
                    <Button type="primary" onClick={() => navigate('/settings/accounts')}>
                      去设置
                    </Button>
                  )}
                </div>
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}
