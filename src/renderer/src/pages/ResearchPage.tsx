import {
  Button,
  Empty,
  Flexbox,
  Modal,
  Select,
  Spin,
  Table,
  Tag,
  Text,
  toast,
} from '@lobehub/ui'
import { Section } from '@lobehub/ui/dashboard'
import { Clapperboard, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ResearchVideoSummary } from '../../../shared/research'
import type { TopicItem } from '../../../shared/topic'
import { DouyinTitleLink } from '../components/DouyinTitleLink'
import { VideoCoverThumb } from '../components/VideoCoverThumb'
import { VideoPlayerModal, type VideoPlayerTarget } from '../components/VideoPlayerModal'
import { navigate, researchVideoHref } from '../routes'
import { getStudio } from '../studioApi'
import { tablePagination } from '../tablePagination'

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

export function ResearchPage() {
  const [topics, setTopics] = useState<TopicItem[]>([])
  const [topicId, setTopicId] = useState<string>('')
  const [videos, setVideos] = useState<ResearchVideoSummary[]>([])
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

  const topicOptions = useMemo(
    () =>
      validTopics.map((item) => ({
        label: `${item.title} · ${item.accountNickname || '未知账号'}`,
        value: item.id,
      })),
    [validTopics],
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

    const preferred =
      nextTopics.find((item) => item.status === 'selected' || item.status === 'kept')?.id ||
      nextTopics[0]?.id ||
      ''
    setTopicId(preferred)

    if (!preferred) {
      setVideos([])
      return
    }

    const nextVideos = await loadVideosWithCovers(preferred)
    setVideos(nextVideos)
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

  // 当前选中已不在列表里时（例如刚删完），清掉非法值，避免 Select 显示 "undefined"
  useEffect(() => {
    if (!topicId) return
    if (validTopics.some((item) => item.id === topicId)) return
    setTopicId(validTopics[0]?.id || '')
    setVideos([])
  }, [topicId, validTopics])

  const changeTopic = async (nextId: string) => {
    if (!nextId || nextId === 'undefined' || nextId === 'null') return
    if (!validTopics.some((item) => item.id === nextId)) {
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

  const openPlayer = async (row: ResearchVideoSummary) => {
    let next = row
    try {
      next = await getStudio().research.enrichVideoMedia(row.id)
      setVideos((prev) => prev.map((item) => (item.id === next.id ? { ...item, ...next } : item)))
    } catch {
      // 仍可用已有封面 / 打开抖音页
    }
    setPlayer({
      title: next.title,
      coverUrl: next.coverUrl,
      playUrl: next.playUrl,
      profileUrl: next.profileUrl,
      awemeId: next.awemeId,
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

  if (validTopics.length === 0) {
    return (
      <div className="page">
        <div className="page-empty">
          {loading ? (
            <Text type="secondary">正在加载…</Text>
          ) : (
            <Empty
              description="先在赛道自测里把细分赛道添加为选题，再回来做样本拆解。"
              icon={Clapperboard}
              title="还没有可选选题"
              action={
                <Button type="primary" onClick={() => navigate('/track')}>
                  去赛道自测
                </Button>
              }
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-toolbar">
        <Select
          options={topicOptions}
          placeholder="先选择选题"
          style={{ minWidth: 260, maxWidth: 420 }}
          value={validTopics.some((item) => item.id === topicId) ? topicId : undefined}
          onChange={(value) => {
            if (value === undefined || value === null || value === '') return
            const nextId = typeof value === 'string' ? value : String(value)
            if (!nextId || nextId === 'undefined' || nextId === 'null') return
            void changeTopic(nextId)
          }}
        />
        <Button
          disabled={!selectedTopic}
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

      <div className="page-stack">
            {analyzing ? (
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
            <Section
              desc="选定选题后开始分析，系统会筛选同方向样本视频；点进详情做文案、结构与评论拆解。"
              title="样本视频"
            >
              {!topicId ? (
                <Text type="secondary">请先选择选题。</Text>
              ) : loading ? (
                <Text type="secondary">正在加载…</Text>
              ) : videos.length === 0 ? (
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
              ) : (
                <Table<ResearchVideoSummary>
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
                      width: 96,
                      filters: videoTypeFilters,
                      onFilter: (value, row) => row.videoType === value,
                      filterMultiple: true,
                      render: (_: unknown, row) => <Tag>{row.videoType}</Tag>,
                    },
                    {
                      title: '匹配',
                      dataIndex: 'matchScore',
                      key: 'match',
                      width: 80,
                      align: 'right' as const,
                      sorter: (a, b) => a.matchScore - b.matchScore,
                      defaultSortOrder: 'descend' as const,
                    },
                    {
                      title: '时长',
                      key: 'duration',
                      width: 80,
                      sorter: (a, b) => a.durationSec - b.durationSec,
                      render: (_: unknown, row) => formatDuration(row.durationSec),
                    },
                    {
                      title: '赞',
                      key: 'digg',
                      width: 88,
                      align: 'right' as const,
                      sorter: (a, b) => a.diggCount - b.diggCount,
                      render: (_: unknown, row) => formatCount(row.diggCount),
                    },
                    {
                      title: '评',
                      key: 'comment',
                      width: 80,
                      align: 'right' as const,
                      sorter: (a, b) => a.commentCount - b.commentCount,
                      render: (_: unknown, row) => formatCount(row.commentCount),
                    },
                    {
                      title: '状态',
                      key: 'status',
                      width: 100,
                      filters: [
                        { text: '待拆解', value: 'pending' },
                        { text: '已拆解', value: 'ready' },
                      ],
                      onFilter: (value, row) => row.status === value,
                      filterMultiple: true,
                      render: (_: unknown, row) => (
                        <Tag>{row.status === 'ready' ? '已拆解' : '待拆解'}</Tag>
                      ),
                    },
                    {
                      title: '操作',
                      key: 'actions',
                      width: 88,
                      render: (_: unknown, row) => (
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => {
                            navigate(researchVideoHref(row.id))
                          }}
                        >
                          详情
                        </Button>
                      ),
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
