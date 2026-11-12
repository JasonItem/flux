import {
  Button,
  Empty,
  Flexbox,
  Modal,
  Segmented,
  Select,
  Spin,
  Table,
  Tag,
  Text,
  TextArea,
  toast,
} from '@lobehub/ui'
import { Section } from '@lobehub/ui/dashboard'
import { Clapperboard, Link2, ListPlus, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ResearchVideoSummary } from '../../../shared/research'
import type { TopicItem } from '../../../shared/topic'
import { DouyinTitleLink } from '../components/DouyinTitleLink'
import { VideoCoverThumb } from '../components/VideoCoverThumb'
import { VideoPlayerModal, type VideoPlayerTarget } from '../components/VideoPlayerModal'
import { navigate, researchVideoHref } from '../routes'
import { getStudio } from '../studioApi'
import { tablePagination } from '../tablePagination'

type ResearchTab = 'samples' | 'custom' | 'records'

async function loadVideosWithCovers(topicId: string): Promise<ResearchVideoSummary[]> {
  const studio = getStudio()
  const listed = await studio.research.listVideos(topicId)
  const missing = listed.some((item) => !item.coverUrl || !item.playUrl)
  if (!missing) return listed
  try {
    return await studio.research.enrichTopicMedia(topicId)
  } catch {
    return listed
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
}

function formatCount(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`
  return String(value)
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m)}:${String(s).padStart(2, '0')}`
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${String(y)}-${m}-${d} ${hh}:${mm}`
}

function isDissected(row: ResearchVideoSummary): boolean {
  return row.dissectStatus === 'ready' && row.status === 'ready'
}

export function ResearchPage() {
  const [tab, setTab] = useState<ResearchTab>('samples')
  const [topics, setTopics] = useState<TopicItem[]>([])
  const [topicId, setTopicId] = useState<string>('')
  const [videos, setVideos] = useState<ResearchVideoSummary[]>([])
  const [records, setRecords] = useState<ResearchVideoSummary[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [recordsPage, setRecordsPage] = useState(1)
  const [recordsPageSize, setRecordsPageSize] = useState(10)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [customVideos, setCustomVideos] = useState<ResearchVideoSummary[]>([])
  const [customLoading, setCustomLoading] = useState(false)
  const [customUrl, setCustomUrl] = useState('')
  const [customSubmitting, setCustomSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [player, setPlayer] = useState<VideoPlayerTarget | null>(null)

  const selectedTopic = useMemo(
    () => topics.find((item) => item.id === topicId) ?? null,
    [topics, topicId],
  )

  const validTopics = useMemo(
    () => topics.filter((item) => Boolean(item.id) && Boolean(item.title)),
    [topics],
  )

  /** 样本拆解只展示真实选题；自定义/雷达桶只用于对应 Tab 与拆解记录 */
  const sampleTopics = useMemo(
    () =>
      validTopics.filter(
        (item) => item.title !== '自定义拆解' && item.title !== '内容雷达',
      ),
    [validTopics],
  )

  const topicOptions = useMemo(
    () =>
      sampleTopics.map((item) => ({
        label: `${item.title} · ${item.accountNickname || '未知账号'}`,
        value: item.id,
      })),
    [sampleTopics],
  )

  const videoTypeFilters = useMemo(() => {
    const types = [...new Set(videos.map((item) => item.videoType))].sort((a, b) =>
      a.localeCompare(b, 'zh-CN'),
    )
    return types.map((value) => ({ text: value, value }))
  }, [videos])

  const bootstrap = useCallback(async () => {
    const studio = getStudio()
    const nextTopics = (await studio.topic.listTopics()).filter(
      (item) => Boolean(item.id) && Boolean(item.title),
    )
    setTopics(nextTopics)

    const sampleOnly = nextTopics.filter(
      (item) => item.title !== '自定义拆解' && item.title !== '内容雷达',
    )
    const preferred =
      sampleOnly.find((item) => item.status === 'selected' || item.status === 'kept')?.id ||
      sampleOnly[0]?.id ||
      ''
    setTopicId(preferred)

    if (!preferred) {
      setVideos([])
      return
    }

    const nextVideos = await loadVideosWithCovers(preferred)
    setVideos(nextVideos)
  }, [])

  const loadRecords = useCallback(async (page: number, pageSize: number) => {
    setRecordsLoading(true)
    try {
      const result = await getStudio().research.listDissectRecords({
        page,
        pageSize,
      })
      setRecords(result.items)
      setRecordsTotal(result.total)
      setRecordsPage(result.page)
      setRecordsPageSize(result.pageSize)
    } catch (error) {
      toast.error({ title: '读取拆解记录失败', description: errorMessage(error) })
      setRecords([])
      setRecordsTotal(0)
    } finally {
      setRecordsLoading(false)
    }
  }, [])

  const loadCustomVideos = useCallback(async () => {
    setCustomLoading(true)
    try {
      setCustomVideos(await getStudio().research.listCustomVideos())
    } catch (error) {
      toast.error({ title: '读取自定义拆解失败', description: errorMessage(error) })
      setCustomVideos([])
    } finally {
      setCustomLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        await bootstrap()
      } catch (error) {
        toast.error({ title: '读取样本拆解失败', description: errorMessage(error) })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [bootstrap])

  useEffect(() => {
    if (tab !== 'records') return
    void loadRecords(recordsPage, recordsPageSize)
  }, [tab, recordsPage, recordsPageSize, loadRecords])

  useEffect(() => {
    if (tab !== 'custom') return
    void loadCustomVideos()
  }, [tab, loadCustomVideos])

  // 当前选中已不在列表里时（例如刚删完），清掉非法值，避免 Select 显示 "undefined"
  useEffect(() => {
    if (!topicId) return
    if (tab === 'samples') {
      if (sampleTopics.some((item) => item.id === topicId)) return
      const nextId = sampleTopics[0]?.id || ''
      setTopicId(nextId)
      setVideos([])
      if (nextId) void loadVideosWithCovers(nextId).then(setVideos).catch(() => setVideos([]))
      return
    }
    if (validTopics.some((item) => item.id === topicId)) return
    setTopicId(validTopics[0]?.id || '')
    setVideos([])
  }, [topicId, validTopics, sampleTopics, tab])

  const changeTopic = async (nextId: string) => {
    if (!nextId || nextId === 'undefined' || nextId === 'null') return
    if (!sampleTopics.some((item) => item.id === nextId)) {
      toast.error({ title: '切换选题失败', description: '选题不存在或已删除' })
      return
    }
    setTopicId(nextId)
    setLoading(true)
    try {
      const nextVideos = await loadVideosWithCovers(nextId)
      setVideos(nextVideos)
    } catch (error) {
      toast.error({ title: '切换选题失败', description: errorMessage(error) })
      setVideos([])
    } finally {
      setLoading(false)
    }
  }

  const analyze = async () => {
    if (!selectedTopic) {
      toast.error({ title: '请先选择选题' })
      return
    }
    setAnalyzing(true)
    try {
      const result = await getStudio().research.analyzeTopic(topicId)
      let nextVideos = result.videos
      try {
        nextVideos = await getStudio().research.enrichTopicMedia(topicId)
      } catch {
        // 列表可先展示，封面后台失败不阻断
      }
      setVideos(nextVideos)
      toast.success({
        title: '样本已就绪',
        description:
          result.note ||
          `已筛选 ${String(result.videos.length)} 条样本，点进详情后再拆解文案/结构/评论`,
      })
    } catch (error) {
      toast.error({ title: '分析失败', description: errorMessage(error) })
    } finally {
      setAnalyzing(false)
    }
  }

  const enqueueDissect = async (row: ResearchVideoSummary, force = false) => {
    try {
      await getStudio().research.enqueueDissect(row.id, { force })
      setVideos((prev) =>
        prev.map((item) =>
          item.id === row.id
            ? {
                ...item,
                dissectStatus: 'pending',
                status: item.status === 'ready' || force ? 'ready' : 'pending',
              }
            : item,
        ),
      )
      setCustomVideos((prev) =>
        prev.map((item) =>
          item.id === row.id
            ? {
                ...item,
                dissectStatus: 'pending',
                status: item.status === 'ready' || force ? 'ready' : 'pending',
              }
            : item,
        ),
      )
      if (tab === 'records') {
        void loadRecords(recordsPage, recordsPageSize)
      }
      toast.success({
        title: force ? '已加入重新拆解' : '已加入后台拆解',
        description: '可在右上角任务中心查看进度，完成后可一键跳转',
      })
    } catch (error) {
      toast.error({ title: '入队失败', description: errorMessage(error) })
    }
  }

  const submitCustomUrl = async () => {
    const url = customUrl.trim()
    if (!url) {
      toast.error({ title: '请先粘贴视频链接' })
      return
    }
    setCustomSubmitting(true)
    try {
      const result = await getStudio().research.enqueueDissectByUrl({
        url,
        topicId: topicId || null,
        force: true,
      })
      setCustomUrl('')
      await loadCustomVideos()
      if (result.video.topicId && result.video.topicId !== topicId) {
        const nextTopics = (await getStudio().topic.listTopics()).filter(
          (item) => Boolean(item.id) && Boolean(item.title),
        )
        setTopics(nextTopics)
        setTopicId(result.video.topicId)
      }
      toast.success({
        title: result.created ? '已添加拆解任务' : '已更新并重新拆解',
        description: '可在任务中心查看进度，完成后可打开详情',
      })
      window.setTimeout(() => {
        navigate(researchVideoHref(result.video.id))
      }, 350)
    } catch (error) {
      toast.error({ title: '添加失败', description: errorMessage(error) })
    } finally {
      setCustomSubmitting(false)
    }
  }

  const openPlayer = async (row: ResearchVideoSummary) => {
    let next = row
    try {
      next = await getStudio().research.ensureLocalMedia(row.id)
      setVideos((prev) => prev.map((item) => (item.id === next.id ? { ...item, ...next } : item)))
    } catch {
      try {
        next = await getStudio().research.enrichVideoMedia(row.id)
        setVideos((prev) => prev.map((item) => (item.id === next.id ? { ...item, ...next } : item)))
      } catch {
        // 仍可用已有封面 / 打开抖音页
      }
    }
    setPlayer({
      title: next.title,
      coverUrl: next.coverUrl,
      playUrl: next.playUrl,
      profileUrl: next.profileUrl,
      awemeId: next.awemeId,
      researchVideoId: next.id,
      authorNickname: next.authorNickname,
    })
  }

  const removeTopic = async () => {
    if (!topicId || !selectedTopic) return
    const removingId = topicId

    setDeleting(true)
    try {
      await getStudio().topic.deleteTopic(removingId)
      const rest = (await getStudio().topic.listTopics()).filter(
        (item) => Boolean(item.id) && Boolean(item.title),
      )
      setTopics(rest)
      const nextId = rest[0]?.id || ''
      setTopicId(nextId)
      if (nextId) {
        setVideos(await loadVideosWithCovers(nextId))
      } else {
        setVideos([])
      }
      setDeleteOpen(false)
      toast.success({ title: '已删除选题' })
    } catch (error) {
      toast.error({ title: '删除失败', description: errorMessage(error) })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="page">
      <div className="page-toolbar">
        <Segmented<ResearchTab>
          options={[
            { label: '样本拆解', value: 'samples' },
            { label: '自定义拆解', value: 'custom' },
            { label: '拆解记录', value: 'records' },
          ]}
          value={tab}
          onChange={(value) => {
            setTab(value)
          }}
        />
      </div>

      {tab === 'samples' ? (
        <div className="page-toolbar">
          <Select
            options={topicOptions}
            placeholder="先选择选题"
            style={{ minWidth: 260, maxWidth: 420 }}
            value={sampleTopics.some((item) => item.id === topicId) ? topicId : undefined}
            onChange={(value) => {
              if (value === undefined || value === null || value === '') return
              const nextId = typeof value === 'string' ? value : String(value)
              if (!nextId || nextId === 'undefined' || nextId === 'null') return
              void changeTopic(nextId)
            }}
          />
          <Button
            disabled={!selectedTopic || !sampleTopics.some((item) => item.id === topicId)}
            icon={videos.length > 0 ? RefreshCw : Play}
            loading={analyzing || loading}
            type="primary"
            onClick={() => {
              void analyze()
            }}
          >
            {videos.length > 0 ? '重新分析' : '开始分析'}
          </Button>
          <Button
            danger
            disabled={!selectedTopic}
            icon={Trash2}
            type="text"
            onClick={() => {
              if (!selectedTopic) return
              setDeleteOpen(true)
            }}
          >
            删除选题
          </Button>
        </div>
      ) : tab === 'custom' ? (
        <div className="page-toolbar">
          <Select
            allowClear
            options={topicOptions}
            placeholder="可选：归属选题（空则用「自定义拆解」）"
            style={{ minWidth: 260, maxWidth: 420 }}
            value={validTopics.some((item) => item.id === topicId) ? topicId : undefined}
            onChange={(value) => {
              if (value === undefined || value === null || value === '') {
                setTopicId('')
                return
              }
              const nextId = typeof value === 'string' ? value : String(value)
              if (!nextId || nextId === 'undefined' || nextId === 'null') return
              setTopicId(nextId)
            }}
          />
          <Button
            icon={RefreshCw}
            loading={customLoading}
            type="text"
            onClick={() => {
              void loadCustomVideos()
            }}
          >
            刷新列表
          </Button>
        </div>
      ) : (
        <div className="page-toolbar">
          <Button
            icon={RefreshCw}
            loading={recordsLoading}
            type="text"
            onClick={() => {
              void loadRecords(recordsPage, recordsPageSize)
            }}
          >
            刷新记录
          </Button>
        </div>
      )}

      <div className="page-stack">
        {tab === 'samples' ? (
          sampleTopics.length === 0 ? (
            <div className="section-empty">
              {loading ? (
                <Text type="secondary">正在加载…</Text>
              ) : (
                <Empty
                  description="先在赛道自测里把细分赛道添加为选题，或改用「自定义拆解」粘贴链接。"
                  icon={Clapperboard}
                  title="还没有可选选题"
                  action={
                    <Flexbox gap={8} horizontal>
                      <Button type="primary" onClick={() => navigate('/track')}>
                        去赛道自测
                      </Button>
                      <Button
                        type="text"
                        onClick={() => {
                          setTab('custom')
                        }}
                      >
                        自定义拆解
                      </Button>
                    </Flexbox>
                  }
                />
              )}
            </div>
          ) : analyzing ? (
            <div className="page-empty">
              <div className="research-loading">
                <Spin size="large" />
                <Text weight={600}>正在筛选样本</Text>
                <Text type="secondary">
                  搜索同选题视频并抓取评论预览，文案/结构拆解会在点进详情时进行…
                </Text>
              </div>
            </div>
          ) : (
            <Section title="样本视频">
              {!topicId ? (
                <Text type="secondary">请先选择选题。</Text>
              ) : loading ? (
                <Text type="secondary">正在加载…</Text>
              ) : videos.length === 0 ? (
                <div className="section-empty">
                  <Empty
                    description="点击「开始分析」，按当前选题筛样本视频。"
                    title="还没有样本"
                    action={
                      <Button
                        icon={Play}
                        loading={analyzing}
                        type="primary"
                        onClick={() => {
                          void analyze()
                        }}
                      >
                        开始分析
                      </Button>
                    }
                  />
                </div>
              ) : (
                <Table<ResearchVideoSummary>
                  className="table-headers-nowrap"
                  columns={[
                    {
                      title: '视频',
                      key: 'title',
                      sorter: (a, b) => a.title.localeCompare(b.title, 'zh-CN'),
                      render: (_: unknown, row) => (
                        <Flexbox gap={10} horizontal style={{ alignItems: 'center', minWidth: 0 }}>
                          <VideoCoverThumb
                            coverUrl={row.coverUrl}
                            title={row.title}
                            onPlay={() => {
                              void openPlayer(row)
                            }}
                          />
                          <Flexbox gap={2} style={{ minWidth: 0, flex: 1 }}>
                            <DouyinTitleLink
                              awemeId={row.awemeId}
                              className="research-video-title-link--table"
                              profileUrl={row.profileUrl}
                              title={row.title}
                            />
                            <Text type="secondary">
                              {row.authorNickname}
                              {row.authorUniqueId ? ` · @${row.authorUniqueId}` : ''}
                            </Text>
                          </Flexbox>
                        </Flexbox>
                      ),
                    },
                    {
                      title: '类型',
                      key: 'type',
                      width: 104,
                      filters: videoTypeFilters,
                      onFilter: (value, row) => row.videoType === value,
                      filterMultiple: true,
                      render: (_: unknown, row) => <Tag>{row.videoType}</Tag>,
                    },
                    {
                      title: '匹配',
                      dataIndex: 'matchScore',
                      key: 'match',
                      width: 96,
                      align: 'right' as const,
                      sorter: (a, b) => a.matchScore - b.matchScore,
                      defaultSortOrder: 'descend' as const,
                    },
                    {
                      title: '时长',
                      key: 'duration',
                      width: 96,
                      sorter: (a, b) => a.durationSec - b.durationSec,
                      render: (_: unknown, row) => formatDuration(row.durationSec),
                    },
                    {
                      title: '赞',
                      key: 'digg',
                      width: 96,
                      align: 'right' as const,
                      sorter: (a, b) => a.diggCount - b.diggCount,
                      render: (_: unknown, row) => formatCount(row.diggCount),
                    },
                    {
                      title: '评',
                      key: 'comment',
                      width: 96,
                      align: 'right' as const,
                      sorter: (a, b) => a.commentCount - b.commentCount,
                      render: (_: unknown, row) => formatCount(row.commentCount),
                    },
                    {
                      title: '状态',
                      key: 'status',
                      width: 120,
                      filters: [
                        { text: '待拆解', value: 'pending' },
                        { text: '已拆解', value: 'ready' },
                        { text: '失败', value: 'error' },
                      ],
                      onFilter: (value, row) =>
                        value === 'error'
                          ? row.dissectStatus === 'error' || row.status === 'error'
                          : row.status === value,
                      filterMultiple: true,
                      render: (_: unknown, row) => {
                        if (row.dissectStatus === 'error' || row.status === 'error') {
                          return <Tag>失败</Tag>
                        }
                        if (row.dissectStatus === 'ready' && row.status === 'ready') {
                          return <Tag>已拆解</Tag>
                        }
                        if (
                          row.dissectStatus === 'downloading' ||
                          row.dissectStatus === 'transcribing' ||
                          row.dissectStatus === 'analyzing'
                        ) {
                          return <Tag>进行中</Tag>
                        }
                        return <Tag>待拆解</Tag>
                      },
                    },
                    {
                      title: '操作',
                      key: 'actions',
                      width: 200,
                      render: (_: unknown, row) => {
                        const done = isDissected(row)
                        return (
                          <Flexbox gap={6} horizontal>
                            <Button
                              icon={done ? RefreshCw : ListPlus}
                              size="small"
                              type="text"
                              onClick={() => {
                                void enqueueDissect(row, done)
                              }}
                            >
                              {done ? '重新拆解' : '拆解'}
                            </Button>
                            <Button
                              size="small"
                              type="primary"
                              onClick={() => {
                                navigate(researchVideoHref(row.id))
                              }}
                            >
                              详情
                            </Button>
                          </Flexbox>
                        )
                      },
                    },
                  ]}
                  dataSource={videos}
                  pagination={tablePagination(20)}
                  rowKey="id"
                  size="small"
                  variant="filled"
                />
              )}
            </Section>
          )
        ) : tab === 'custom' ? (
          <>
            <Section title="添加链接">
              <Flexbox gap={12}>
                <TextArea
                  placeholder="粘贴抖音分享口令或视频链接，例如 https://v.douyin.com/… 或 https://www.douyin.com/video/…"
                  rows={3}
                  value={customUrl}
                  onChange={(event) => {
                    setCustomUrl(event.target.value)
                  }}
                />
                <Flexbox gap={8} horizontal wrap="wrap">
                  <Button
                    icon={Link2}
                    loading={customSubmitting}
                    type="primary"
                    onClick={() => {
                      void submitCustomUrl()
                    }}
                  >
                    添加拆解任务
                  </Button>
                  <Button
                    disabled={!customUrl.trim()}
                    type="text"
                    onClick={() => {
                      setCustomUrl('')
                    }}
                  >
                    清空
                  </Button>
                </Flexbox>
              </Flexbox>
            </Section>

            <Section title="自定义任务">
              {customLoading && customVideos.length === 0 ? (
                <Text type="secondary">正在加载…</Text>
              ) : customVideos.length === 0 ? (
                <div className="section-empty">
                  <Empty
                    description="粘贴上方链接后点击「添加拆解任务」，进度可在任务中心查看。"
                    icon={Link2}
                    title="还没有自定义拆解"
                  />
                </div>
              ) : (
                <Table<ResearchVideoSummary>
                  className="table-with-pager table-headers-nowrap"
                  columns={[
                    {
                      title: '视频',
                      key: 'title',
                      render: (_: unknown, row) => (
                        <Flexbox gap={10} horizontal style={{ alignItems: 'center', minWidth: 0 }}>
                          <VideoCoverThumb
                            coverUrl={row.coverUrl}
                            title={row.title}
                            onPlay={() => {
                              void openPlayer(row)
                            }}
                          />
                          <Flexbox gap={2} style={{ minWidth: 0, flex: 1 }}>
                            <DouyinTitleLink
                              awemeId={row.awemeId}
                              className="research-video-title-link--table"
                              profileUrl={row.profileUrl}
                              title={row.title}
                            />
                            <Text type="secondary">
                              {row.authorNickname}
                              {row.authorUniqueId ? ` · @${row.authorUniqueId}` : ''}
                            </Text>
                          </Flexbox>
                        </Flexbox>
                      ),
                    },
                    {
                      title: '选题',
                      key: 'topic',
                      width: 140,
                      ellipsis: true,
                      render: (_: unknown, row) => (
                        <Text type="secondary">{row.topicTitle || '—'}</Text>
                      ),
                    },
                    {
                      title: '时长',
                      key: 'duration',
                      width: 88,
                      render: (_: unknown, row) => formatDuration(row.durationSec),
                    },
                    {
                      title: '状态',
                      key: 'status',
                      width: 110,
                      render: (_: unknown, row) => {
                        if (row.dissectStatus === 'error' || row.status === 'error') {
                          return <Tag>失败</Tag>
                        }
                        if (row.dissectStatus === 'ready' && row.status === 'ready') {
                          return <Tag>已拆解</Tag>
                        }
                        if (
                          row.dissectStatus === 'downloading' ||
                          row.dissectStatus === 'transcribing' ||
                          row.dissectStatus === 'analyzing' ||
                          row.dissectStatus === 'pending'
                        ) {
                          return <Tag>进行中</Tag>
                        }
                        return <Tag>待拆解</Tag>
                      },
                    },
                    {
                      title: '更新',
                      key: 'updated',
                      width: 168,
                      render: (_: unknown, row) => (
                        <span className="table-cell-nowrap">
                          <Text type="secondary">{formatUpdatedAt(row.updatedAt)}</Text>
                        </span>
                      ),
                    },
                    {
                      title: '操作',
                      key: 'actions',
                      width: 200,
                      render: (_: unknown, row) => {
                        const done = isDissected(row)
                        return (
                          <Flexbox gap={6} horizontal>
                            <Button
                              icon={done ? RefreshCw : ListPlus}
                              size="small"
                              type="text"
                              onClick={() => {
                                void enqueueDissect(row, done)
                              }}
                            >
                              {done ? '重新拆解' : '拆解'}
                            </Button>
                            <Button
                              size="small"
                              type="primary"
                              onClick={() => {
                                navigate(researchVideoHref(row.id))
                              }}
                            >
                              详情
                            </Button>
                          </Flexbox>
                        )
                      },
                    },
                  ]}
                  dataSource={customVideos}
                  pagination={tablePagination(10)}
                  rowKey="id"
                  size="small"
                  variant="filled"
                />
              )}
            </Section>
          </>
        ) : (
          <Section title="拆解记录">
            {recordsLoading && records.length === 0 ? (
              <Text type="secondary">正在加载拆解记录…</Text>
            ) : recordsTotal === 0 ? (
              <div className="section-empty">
                <Empty
                  description="完成至少一条样本拆解后，记录会出现在这里。"
                  title="还没有拆解记录"
                  action={
                    <Button
                      type="primary"
                      onClick={() => {
                        setTab('samples')
                      }}
                    >
                      去样本拆解
                    </Button>
                  }
                />
              </div>
            ) : (
              <Table<ResearchVideoSummary>
                className="table-with-pager table-headers-nowrap"
                columns={[
                  {
                    title: '视频',
                    key: 'title',
                    render: (_: unknown, row) => (
                      <Flexbox gap={10} horizontal style={{ alignItems: 'center', minWidth: 0 }}>
                        <VideoCoverThumb
                          coverUrl={row.coverUrl}
                          title={row.title}
                          onPlay={() => {
                            void openPlayer(row)
                          }}
                        />
                        <Flexbox gap={2} style={{ minWidth: 0, flex: 1 }}>
                          <DouyinTitleLink
                            awemeId={row.awemeId}
                            className="research-video-title-link--table"
                            profileUrl={row.profileUrl}
                            title={row.title}
                          />
                          <Text type="secondary">
                            {row.authorNickname}
                            {row.authorUniqueId ? ` · @${row.authorUniqueId}` : ''}
                          </Text>
                        </Flexbox>
                      </Flexbox>
                    ),
                  },
                  {
                    title: '选题',
                    key: 'topic',
                    width: 180,
                    render: (_: unknown, row) => (
                      <Text type="secondary">{row.topicTitle || '—'}</Text>
                    ),
                  },
                  {
                    title: '类型',
                    key: 'type',
                    width: 88,
                    render: (_: unknown, row) => <Tag>{row.videoType}</Tag>,
                  },
                  {
                    title: '时长',
                    key: 'duration',
                    width: 72,
                    render: (_: unknown, row) => formatDuration(row.durationSec),
                  },
                  {
                    title: '赞',
                    key: 'digg',
                    width: 80,
                    align: 'right' as const,
                    render: (_: unknown, row) => formatCount(row.diggCount),
                  },
                  {
                    title: '评',
                    key: 'comment',
                    width: 72,
                    align: 'right' as const,
                    render: (_: unknown, row) => formatCount(row.commentCount),
                  },
                  {
                    title: '完成时间',
                    key: 'updated',
                    width: 168,
                    render: (_: unknown, row) => (
                      <span className="table-cell-nowrap">
                        <Text type="secondary">{formatUpdatedAt(row.updatedAt)}</Text>
                      </span>
                    ),
                  },
                  {
                    title: '操作',
                    key: 'actions',
                    width: 200,
                    render: (_: unknown, row) => (
                      <Flexbox gap={6} horizontal>
                        <Button
                          icon={RefreshCw}
                          size="small"
                          type="text"
                          onClick={() => {
                            void enqueueDissect(row, true)
                          }}
                        >
                          重新拆解
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => {
                            navigate(researchVideoHref(row.id))
                          }}
                        >
                          详情
                        </Button>
                      </Flexbox>
                    ),
                  },
                ]}
                dataSource={records}
                loading={recordsLoading}
                pagination={{
                  ...tablePagination(recordsPageSize),
                  current: recordsPage,
                  pageSize: recordsPageSize,
                  total: recordsTotal,
                  onChange: (page, pageSize) => {
                    const nextSize = pageSize || recordsPageSize
                    setRecordsPage(page)
                    setRecordsPageSize(nextSize)
                  },
                }}
                rowKey="id"
                size="small"
                variant="filled"
              />
            )}
          </Section>
        )}
      </div>

      <Modal
        confirmLoading={deleting}
        destroyOnHidden
        okButtonProps={{ danger: true }}
        okText="删除"
        open={deleteOpen}
        title="删除选题"
        onCancel={() => {
          if (deleting) return
          setDeleteOpen(false)
        }}
        onOk={() => {
          void removeTopic()
        }}
      >
        <Text>
          确定删除选题「{selectedTopic?.title ?? ''}」？相关样本分析结果会一并删除，此操作不可恢复。
        </Text>
      </Modal>

      <VideoPlayerModal
        open={Boolean(player)}
        video={player}
        onClose={() => {
          setPlayer(null)
        }}
      />
    </div>
  )
}
