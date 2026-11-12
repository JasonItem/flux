import {
  Button,
  Empty,
  Flexbox,
  Input,
  InputNumber,
  Segmented,
  Switch,
  Table,
  Tag,
  Text,
  TextArea,
  toast,
} from '@lobehub/ui'
import { ListPlus, Plus, Radar, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  RadarAccount,
  RadarSignalFilter,
  RadarWork,
} from '../../../shared/radar'
import { DouyinTitleLink } from '../components/DouyinTitleLink'
import { VideoCoverThumb } from '../components/VideoCoverThumb'
import { VideoPlayerModal, type VideoPlayerTarget } from '../components/VideoPlayerModal'
import { navigate, researchVideoHref } from '../routes'
import { getStudio } from '../studioApi'
import { tablePagination } from '../tablePagination'

type RadarTab = 'signals' | 'accounts' | 'rules'

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '操作失败'
  return (
    error.message
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '')
      .trim() || '操作失败'
  )
}

function formatCount(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`
  return String(value)
}

/** 列表里已入库的 0 播放：按赞×25 估播展示（接口常不回真实播放量） */
function displayPlayCount(row: { playCount: number; diggCount: number }): number {
  if (row.playCount > 0) return row.playCount
  return Math.max(0, row.diggCount) * 25
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${String(m)}:${String(s).padStart(2, '0')}` : `${String(s)}秒`
}

export function RadarPage() {
  const [tab, setTab] = useState<RadarTab>('signals')
  const [filter, setFilter] = useState<RadarSignalFilter>('all')
  const [signals, setSignals] = useState<RadarWork[]>([])
  const [accounts, setAccounts] = useState<RadarAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [hotLoading, setHotLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [savingRules, setSavingRules] = useState(false)
  const [accountInput, setAccountInput] = useState('')
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [dissectingId, setDissectingId] = useState<string | null>(null)
  const [player, setPlayer] = useState<VideoPlayerTarget | null>(null)

  const [draftRules, setDraftRules] = useState({
    highMinDigg: 10000,
    highMinPlay: 0,
    newWithinHours: 72,
    hotKeywords: '',
    autoSyncEnabled: false,
    syncIntervalMinutes: 120,
  })

  const refreshSignals = useCallback(async (nextFilter = filter) => {
    const list = await getStudio().radar.listSignals({ filter: nextFilter, limit: 500 })
    setSignals(list)
  }, [filter])

  const refreshAccounts = useCallback(async () => {
    setAccounts(await getStudio().radar.listAccounts())
  }, [])

  const refreshRules = useCallback(async () => {
    const next = await getStudio().radar.getRules()
    setDraftRules({
      highMinDigg: next.highMinDigg,
      highMinPlay: next.highMinPlay,
      newWithinHours: next.newWithinHours,
      hotKeywords: next.hotKeywords,
      autoSyncEnabled: next.autoSyncEnabled,
      syncIntervalMinutes: next.syncIntervalMinutes,
    })
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([refreshSignals(), refreshAccounts(), refreshRules()])
    } catch (error) {
      toast.error({ title: '加载内容雷达失败', description: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [refreshAccounts, refreshRules, refreshSignals])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (tab !== 'signals') return
    void refreshSignals(filter).catch((error) => {
      toast.error({ title: '读取信号失败', description: errorMessage(error) })
    })
  }, [filter, refreshSignals, tab])

  const filterOptions = useMemo(
    () => [
      { label: '全部', value: 'all' as const },
      { label: '高表现', value: 'high' as const },
      { label: '新作', value: 'new' as const },
      { label: '平台热榜', value: 'hot' as const },
    ],
    [],
  )

  async function addAccount() {
    const input = accountInput.trim()
    if (!input) {
      toast.error({ title: '请填写账号主页链接、抖音号或 sec_uid' })
      return
    }
    setAdding(true)
    try {
      await getStudio().radar.addAccount(input)
      setAccountInput('')
      await Promise.all([refreshAccounts(), refreshSignals()])
      toast.success({ title: '已添加对标账号' })
      setTab('accounts')
    } catch (error) {
      toast.error({ title: '添加失败', description: errorMessage(error) })
    } finally {
      setAdding(false)
    }
  }

  async function syncAll() {
    setSyncing(true)
    try {
      const results = await getStudio().radar.syncAllAccounts()
      await Promise.all([refreshAccounts(), refreshSignals()])
      const fetched = results.reduce((sum, item) => sum + item.fetched, 0)
      toast.success({
        title: '同步完成',
        description: `已监听 ${String(results.length)} 个账号，拉取 ${String(fetched)} 条作品`,
      })
    } catch (error) {
      toast.error({ title: '同步失败', description: errorMessage(error) })
    } finally {
      setSyncing(false)
    }
  }

  async function refreshHot() {
    setHotLoading(true)
    try {
      await getStudio().radar.refreshHot()
      if (filter !== 'hot') setFilter('hot')
      else await refreshSignals('hot')
    } catch (error) {
      toast.error({ title: '拉取热榜失败', description: errorMessage(error) })
    } finally {
      setHotLoading(false)
    }
  }

  async function saveRules() {
    setSavingRules(true)
    try {
      await getStudio().radar.updateRules(draftRules)
      await refreshSignals()
      toast.success({ title: '监听规则已保存' })
    } catch (error) {
      toast.error({ title: '保存失败', description: errorMessage(error) })
    } finally {
      setSavingRules(false)
    }
  }

  async function enqueueDissect(row: RadarWork) {
    const awemeId = row.awemeId?.trim()
    if (!awemeId) {
      toast.error({ title: '缺少视频 ID，无法拆解' })
      return
    }
    setDissectingId(row.id)
    try {
      const result = await getStudio().research.enqueueDissectByUrl({
        url: `https://www.douyin.com/video/${awemeId}`,
        force: false,
        destination: 'records',
      })
      toast.success({
        title: result.created ? '已加入拆解' : '已加入重新拆解',
        description: '进度可在任务队列查看，完成后出现在「拆解记录」',
      })
      window.setTimeout(() => {
        navigate(researchVideoHref(result.video.id))
      }, 350)
    } catch (error) {
      toast.error({ title: '拆解入队失败', description: errorMessage(error) })
    } finally {
      setDissectingId(null)
    }
  }

  return (
    <div className="page">
      <div className="page-toolbar">
        <Segmented<RadarTab>
          options={[
            { label: '雷达信号', value: 'signals' },
            { label: '对标账号', value: 'accounts' },
            { label: '监听规则', value: 'rules' },
          ]}
          value={tab}
          onChange={(value) => {
            setTab(value)
          }}
        />
      </div>

      {tab === 'signals' ? (
        <div className="page-stack">
          <div className="page-toolbar page-toolbar--spread">
            <Segmented<RadarSignalFilter>
              options={filterOptions}
              value={filter}
              onChange={(value) => {
                setFilter(value)
              }}
            />
            <Flexbox gap={8} horizontal>
              <Button
                icon={RefreshCw}
                loading={syncing}
                type="primary"
                onClick={() => {
                  void syncAll()
                }}
              >
                同步对标作品
              </Button>
              <Button
                icon={Radar}
                loading={hotLoading}
                onClick={() => {
                  void refreshHot()
                }}
              >
                刷新平台热榜
              </Button>
            </Flexbox>
          </div>

          {loading ? (
            <Text type="secondary">正在加载雷达信号…</Text>
          ) : signals.length === 0 ? (
            <Empty
              action={
                accounts.length === 0 ? (
                  <Button
                    type="primary"
                    onClick={() => {
                      setTab('accounts')
                    }}
                  >
                    添加对标账号
                  </Button>
                ) : undefined
              }
              description={
                accounts.length === 0
                  ? '先在「对标账号」添加抖音账号，再回来查看信号。'
                  : '暂无匹配当前筛选的作品，可同步对标作品或刷新热榜。'
              }
              icon={Radar}
              title="暂无雷达信号"
            />
          ) : (
            <Table<RadarWork>
              className="table-headers-nowrap"
              columns={[
                {
                  title: '作品',
                  key: 'title',
                  render: (_: unknown, row) => (
                    <Flexbox gap={10} horizontal style={{ alignItems: 'center', minWidth: 0 }}>
                      <VideoCoverThumb
                        coverUrl={row.coverUrl}
                        title={row.title}
                        onPlay={() => {
                          setPlayer({
                            title: row.title,
                            coverUrl: row.coverUrl,
                            playUrl: row.playUrl,
                            profileUrl: row.profileUrl ?? '',
                            awemeId: row.awemeId,
                            authorNickname: row.authorNickname,
                          })
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
                  title: '标签',
                  key: 'flags',
                  width: 180,
                  render: (_: unknown, row) => (
                    <Flexbox gap={4} horizontal style={{ flexWrap: 'wrap' }}>
                      {row.isHigh ? <Tag>高表现</Tag> : null}
                      {row.isNew ? <Tag>新作</Tag> : null}
                      {row.isHot ? <Tag>热榜</Tag> : null}
                      {!row.isHigh && !row.isNew && !row.isHot ? (
                        <Text type="secondary">—</Text>
                      ) : null}
                    </Flexbox>
                  ),
                },
                {
                  title: '时长',
                  key: 'duration',
                  width: 88,
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
                  title: '播',
                  key: 'play',
                  width: 96,
                  align: 'right' as const,
                  sorter: (a, b) => displayPlayCount(a) - displayPlayCount(b),
                  render: (_: unknown, row) => formatCount(displayPlayCount(row)),
                },
                {
                  title: '评',
                  key: 'comment',
                  width: 88,
                  align: 'right' as const,
                  sorter: (a, b) => a.commentCount - b.commentCount,
                  render: (_: unknown, row) => formatCount(row.commentCount),
                },
                {
                  title: '发布',
                  key: 'publish',
                  width: 120,
                  sorter: (a, b) =>
                    String(a.publishAt ?? '').localeCompare(String(b.publishAt ?? '')),
                  render: (_: unknown, row) => formatTime(row.publishAt),
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 100,
                  render: (_: unknown, row) => (
                    <Button
                      icon={ListPlus}
                      loading={dissectingId === row.id}
                      size="small"
                      type="primary"
                      onClick={() => {
                        void enqueueDissect(row)
                      }}
                    >
                      拆解
                    </Button>
                  ),
                },
              ]}
              dataSource={signals}
              pagination={tablePagination(signals.length)}
              rowKey="id"
              variant="filled"
            />
          )}
        </div>
      ) : null}

      {tab === 'accounts' ? (
        <div className="page-stack">
          <div className="page-toolbar">
            <Input
              placeholder="粘贴抖音主页链接、抖音号或 sec_uid"
              style={{ minWidth: 320, maxWidth: 520, flex: 1 }}
              value={accountInput}
              onChange={(event) => {
                setAccountInput(event.target.value)
              }}
              onPressEnter={() => {
                void addAccount()
              }}
            />
            <Button
              icon={Plus}
              loading={adding}
              type="primary"
              onClick={() => {
                void addAccount()
              }}
            >
              添加账号
            </Button>
            <Button
              icon={RefreshCw}
              loading={syncing}
              onClick={() => {
                void syncAll()
              }}
            >
              全部同步
            </Button>
          </div>

          {loading ? (
            <Text type="secondary">正在加载对标账号…</Text>
          ) : accounts.length === 0 ? (
            <Empty
              description="添加后会监听其新作品，并按规则标记高表现与新作。"
              title="还没有对标账号"
            />
          ) : (
            <Table<RadarAccount>
              className="table-headers-nowrap"
              columns={[
                {
                  title: '账号',
                  key: 'nickname',
                  render: (_: unknown, row) => (
                    <Flexbox gap={2}>
                      <Text weight={500}>{row.nickname}</Text>
                      <Text type="secondary">
                        {row.uniqueId ? `@${row.uniqueId}` : row.secUserId.slice(0, 16)}
                      </Text>
                    </Flexbox>
                  ),
                },
                {
                  title: '粉丝',
                  key: 'followers',
                  width: 100,
                  align: 'right' as const,
                  render: (_: unknown, row) => formatCount(row.followerCount),
                },
                {
                  title: '作品数',
                  key: 'works',
                  width: 100,
                  align: 'right' as const,
                  render: (_: unknown, row) => String(row.workCount),
                },
                {
                  title: '最近同步',
                  key: 'synced',
                  width: 140,
                  render: (_: unknown, row) => formatTime(row.lastSyncedAt),
                },
                {
                  title: '监听',
                  key: 'enabled',
                  width: 90,
                  render: (_: unknown, row) => (
                    <Switch
                      checked={row.enabled}
                      onChange={(checked) => {
                        setBusyAccountId(row.id)
                        void getStudio()
                          .radar.setAccountEnabled(row.id, checked)
                          .then(async () => {
                            await refreshAccounts()
                          })
                          .catch((error) => {
                            toast.error({
                              title: '更新失败',
                              description: errorMessage(error),
                            })
                          })
                          .finally(() => {
                            setBusyAccountId(null)
                          })
                      }}
                    />
                  ),
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 180,
                  render: (_: unknown, row) => (
                    <Flexbox gap={4} horizontal>
                      <Button
                        loading={busyAccountId === row.id}
                        size="small"
                        type="text"
                        onClick={() => {
                          setBusyAccountId(row.id)
                          void getStudio()
                            .radar.syncAccount(row.id)
                            .then(async (result) => {
                              await Promise.all([refreshAccounts(), refreshSignals()])
                              toast.success({
                                title: `已同步 ${row.nickname}`,
                                description: `拉取 ${String(result.fetched)} 条`,
                              })
                            })
                            .catch((error) => {
                              toast.error({
                                title: '同步失败',
                                description: errorMessage(error),
                              })
                            })
                            .finally(() => {
                              setBusyAccountId(null)
                            })
                        }}
                      >
                        同步
                      </Button>
                      <Button
                        danger
                        icon={Trash2}
                        size="small"
                        type="text"
                        onClick={() => {
                          setBusyAccountId(row.id)
                          void getStudio()
                            .radar.removeAccount(row.id)
                            .then(async () => {
                              await Promise.all([refreshAccounts(), refreshSignals()])
                              toast.success({ title: '已移除对标账号' })
                            })
                            .catch((error) => {
                              toast.error({
                                title: '移除失败',
                                description: errorMessage(error),
                              })
                            })
                            .finally(() => {
                              setBusyAccountId(null)
                            })
                        }}
                      >
                        移除
                      </Button>
                    </Flexbox>
                  ),
                },
              ]}
              dataSource={accounts}
              pagination={false}
              rowKey="id"
              variant="filled"
            />
          )}
        </div>
      ) : null}

      {tab === 'rules' ? (
        <div className="page-stack" style={{ maxWidth: 640 }}>
          <Flexbox gap={4}>
            <Text weight={600}>高表现阈值</Text>
            <Text type="secondary">
              满足点赞或播放任一阈值即标记为高表现；设为 0 表示不启用该门槛。
            </Text>
          </Flexbox>
          <Flexbox gap={12} horizontal style={{ flexWrap: 'wrap' }}>
            <Flexbox gap={6} style={{ minWidth: 200 }}>
              <Text type="secondary">最低点赞</Text>
              <InputNumber
                min={0}
                step={1000}
                style={{ width: '100%' }}
                value={draftRules.highMinDigg}
                onChange={(value) => {
                  setDraftRules((prev) => ({
                    ...prev,
                    highMinDigg: typeof value === 'number' ? value : 0,
                  }))
                }}
              />
            </Flexbox>
            <Flexbox gap={6} style={{ minWidth: 200 }}>
              <Text type="secondary">最低播放</Text>
              <InputNumber
                min={0}
                step={1000}
                style={{ width: '100%' }}
                value={draftRules.highMinPlay}
                onChange={(value) => {
                  setDraftRules((prev) => ({
                    ...prev,
                    highMinPlay: typeof value === 'number' ? value : 0,
                  }))
                }}
              />
            </Flexbox>
          </Flexbox>

          <Flexbox gap={4}>
            <Text weight={600}>新作窗口</Text>
            <Text type="secondary">发布时间在该小时数内的作品标记为新作。</Text>
          </Flexbox>
          <InputNumber
            min={1}
            step={1}
            style={{ maxWidth: 240 }}
            suffix="小时"
            value={draftRules.newWithinHours}
            onChange={(value) => {
              setDraftRules((prev) => ({
                ...prev,
                newWithinHours: typeof value === 'number' ? value : 72,
              }))
            }}
          />

          <Flexbox gap={4}>
            <Text weight={600}>平台热榜关键词</Text>
            <Text type="secondary">
              按行或逗号分隔，最多 20 个关键词；每个词会拉多页「热门 + 综合」结果。关键词越多，热榜越丰富。
            </Text>
          </Flexbox>
          <TextArea
            placeholder={'例如：\nAI短视频\n干货口播'}
            rows={4}
            value={draftRules.hotKeywords}
            onChange={(event) => {
              setDraftRules((prev) => ({
                ...prev,
                hotKeywords: event.target.value,
              }))
            }}
          />

          <Flexbox gap={4}>
            <Text weight={600}>自动同步</Text>
            <Text type="secondary">开启后会按间隔自动同步已启用的对标账号。</Text>
          </Flexbox>
          <Flexbox gap={12} horizontal style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Switch
              checked={draftRules.autoSyncEnabled}
              onChange={(checked) => {
                setDraftRules((prev) => ({ ...prev, autoSyncEnabled: checked }))
              }}
            />
            <InputNumber
              disabled={!draftRules.autoSyncEnabled}
              min={15}
              step={15}
              style={{ maxWidth: 200 }}
              suffix="分钟"
              value={draftRules.syncIntervalMinutes}
              onChange={(value) => {
                setDraftRules((prev) => ({
                  ...prev,
                  syncIntervalMinutes: typeof value === 'number' ? value : 120,
                }))
              }}
            />
          </Flexbox>

          <Button
            loading={savingRules}
            type="primary"
            onClick={() => {
              void saveRules()
            }}
          >
            保存规则
          </Button>
        </div>
      ) : null}

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