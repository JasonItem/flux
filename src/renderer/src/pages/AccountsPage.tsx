import {
  Alert,
  Avatar,
  Button,
  Empty,
  Flexbox,
  Segmented,
  Select,
  Table,
  Tag,
  Text,
  toast,
} from '@lobehub/ui'
import { Surface } from '@lobehub/ui/dashboard'
import {
  ChartColumn,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Play,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  AccountAnalysisDetail,
  AccountAnalysisVideoRow,
  AccountPerformanceTag,
  AccountTopicPlan,
  AccountWorkCollection,
} from '../../../shared/accountAnalysis'
import type { DouyinAccount } from '../../../shared/tikhub'
import { DouyinTitleLink } from '../components/DouyinTitleLink'
import { PortraitPanel } from '../components/PortraitCharts'
import { VideoCoverThumb } from '../components/VideoCoverThumb'
import { accountVideoHref, navigate } from '../routes'
import { getStudio } from '../studioApi'
import { tablePagination } from '../tablePagination'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`
  return String(Math.round(value))
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m)}:${String(s).padStart(2, '0')}`
}

function performanceLabel(tag: AccountPerformanceTag): string {
  switch (tag) {
    case 'high':
      return '高光'
    case 'low':
      return '拖后腿'
    default:
      return '中位'
  }
}

function performanceColor(tag: AccountPerformanceTag): 'success' | 'warning' | undefined {
  if (tag === 'high') return 'success'
  if (tag === 'low') return 'warning'
  return undefined
}

type WorksTab = 'collections' | 'all'

function buildVideoColumns(
  accountId: string,
  collectionNameById: Map<string, string>,
  showCollection: boolean,
  analyzedAwemeIds: Set<string>,
) {
  return [
    {
      title: '视频',
      key: 'title',
      render: (_: unknown, row: AccountAnalysisVideoRow) => (
        <Flexbox gap={10} horizontal style={{ alignItems: 'center', minWidth: 0 }}>
          <VideoCoverThumb
            coverUrl={row.coverUrl}
            title={row.title}
            onPlay={() => {
              if (row.profileUrl) window.open(row.profileUrl, '_blank', 'noreferrer')
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
              {row.videoType}
              {showCollection && row.collectionId
                ? ` · ${collectionNameById.get(row.collectionId) || '作品集'}`
                : ''}
            </Text>
          </Flexbox>
        </Flexbox>
      ),
    },
    {
      title: '时长',
      key: 'duration',
      width: 72,
      render: (_: unknown, row: AccountAnalysisVideoRow) => formatDuration(row.durationSec),
    },
    {
      title: '估播',
      key: 'play',
      width: 80,
      align: 'right' as const,
      render: (_: unknown, row: AccountAnalysisVideoRow) => formatCount(row.estimatedPlay),
    },
    {
      title: '赞',
      key: 'digg',
      width: 72,
      align: 'right' as const,
      render: (_: unknown, row: AccountAnalysisVideoRow) => formatCount(row.diggCount),
    },
    {
      title: '相对分',
      dataIndex: 'relativeScore',
      key: 'score',
      width: 72,
      align: 'right' as const,
    },
    {
      title: '表现',
      key: 'tag',
      width: 88,
      render: (_: unknown, row: AccountAnalysisVideoRow) => (
        <Tag color={performanceColor(row.performanceTag)}>
          {performanceLabel(row.performanceTag)}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_: unknown, row: AccountAnalysisVideoRow) => {
        const analyzed = analyzedAwemeIds.has(row.awemeId)
        return (
          <Flexbox gap={4} horizontal>
            <Button
              size="small"
              type={analyzed ? 'default' : 'primary'}
              onClick={() => {
                navigate(accountVideoHref(accountId, row.awemeId))
              }}
            >
              {analyzed ? '详情' : '分析'}
            </Button>
            {row.profileUrl ? (
              <Button
                icon={ExternalLink}
                size="small"
                type="text"
                onClick={() => {
                  window.open(row.profileUrl, '_blank', 'noreferrer')
                }}
              />
            ) : null}
          </Flexbox>
        )
      },
    },
  ]
}

export function AccountsPage() {
  const [accounts, setAccounts] = useState<DouyinAccount[]>([])
  const [accountId, setAccountId] = useState('')
  const [analysis, setAnalysis] = useState<AccountAnalysisDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [addingTopicId, setAddingTopicId] = useState<string | null>(null)
  const [stageOpen, setStageOpen] = useState(false)
  const [worksTab, setWorksTab] = useState<WorksTab>('collections')

  const accountOptions = useMemo(
    () =>
      accounts.map((item) => ({
        value: item.id,
        label: item.nickname + (item.uniqueId ? ` · @${item.uniqueId}` : ''),
      })),
    [accounts],
  )

  const selectedAccount = useMemo(
    () => accounts.find((item) => item.id === accountId) ?? null,
    [accounts, accountId],
  )

  const collectionNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of analysis?.collections ?? []) map.set(item.id, item.name)
    return map
  }, [analysis?.collections])

  const loadAccount = useCallback(async (nextId: string) => {
    if (!nextId) {
      setAccountId('')
      setAnalysis(null)
      return
    }
    setAccountId(nextId)
    setStageOpen(false)
    setWorksTab('collections')
    setLoading(true)
    try {
      const cached = await getStudio().accountAnalysis.getAnalysis(nextId)
      setAnalysis(cached)
    } catch (error) {
      toast.error({ title: '读取账号分析失败', description: errorMessage(error) })
      setAnalysis(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const bootstrap = useCallback(async () => {
    const nextAccounts = await getStudio().tikhub.listAccounts()
    setAccounts(nextAccounts)
    const preferred =
      nextAccounts.find((item) => item.isActive)?.id || nextAccounts[0]?.id || ''
    if (!preferred) {
      setAccountId('')
      setAnalysis(null)
      return
    }
    await loadAccount(preferred)
  }, [loadAccount])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        await bootstrap()
      } catch (error) {
        toast.error({ title: '读取账号失败', description: errorMessage(error) })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [bootstrap])

  const analyze = async () => {
    if (!accountId) {
      toast.error({ title: '请先选择账号' })
      return
    }
    setAnalyzing(true)
    try {
      const next = await getStudio().accountAnalysis.analyzeAccount(accountId)
      if (next.status === 'failed') {
        toast.error({ title: '分析失败', description: next.error || '请稍后重试' })
        setAnalysis(null)
      } else {
        toast.success({
          title: '分析完成',
          description: `已推断画像并归类 ${String(next.collections.length)} 个作品集`,
        })
        setAnalysis(next)
        setStageOpen(false)
      }
    } catch (error) {
      toast.error({ title: '分析失败', description: errorMessage(error) })
    } finally {
      setAnalyzing(false)
    }
  }

  const addTopic = async (plan: AccountTopicPlan) => {
    if (!accountId) return
    setAddingTopicId(plan.id)
    try {
      await getStudio().topic.addManual({
        accountId,
        title: plan.title,
        summary: plan.targetAudience,
        reason: plan.reason,
        domain: plan.targetAudience,
      })
      toast.success({ title: '已添加选题', description: plan.title })
    } catch (error) {
      toast.error({ title: '添加选题失败', description: errorMessage(error) })
    } finally {
      setAddingTopicId(null)
    }
  }

  const analyzedAwemeIds = useMemo(
    () => new Set(Object.keys(analysis?.videoAnalyses ?? {})),
    [analysis?.videoAnalyses],
  )
  const videoColumns = useMemo(
    () =>
      buildVideoColumns(accountId, collectionNameById, worksTab === 'all', analyzedAwemeIds),
    [accountId, analyzedAwemeIds, collectionNameById, worksTab],
  )

  if (accounts.length === 0) {
    return (
      <div className="page">
        <div className="page-empty">
          {loading ? (
            <Text type="secondary">正在加载…</Text>
          ) : (
            <Empty
              description="账号分析基于已绑定抖音账号的公开作品与评论推断。"
              icon={ChartColumn}
              title="还没有可分析的账号"
              action={
                <Button type="primary" onClick={() => navigate('/settings/accounts')}>
                  去账号管理
                </Button>
              }
            />
          )}
        </div>
      </div>
    )
  }

  const diagnosis = analysis?.diagnosis
  const portrait = analysis?.portrait
  const collections = analysis?.collections ?? []
  const topicPlans = analysis?.topicPlans ?? []
  const videos = analysis?.videos ?? []

  return (
    <div className="page">
      <div className="page-toolbar">
        <Select
          options={accountOptions}
          style={{ minWidth: 220, maxWidth: 320 }}
          value={accountId || undefined}
          onChange={(value) => {
            void loadAccount(String(value))
          }}
        />
        <Button
          disabled={!accountId || loading}
          icon={analysis ? RefreshCw : Play}
          loading={analyzing}
          type="primary"
          onClick={() => {
            void analyze()
          }}
        >
          {analyzing ? '分析中' : analysis ? '重新分析' : '开始分析'}
        </Button>
      </div>

      <div className="page-stack">
        {analyzing ? (
          <Alert
            description="正在拉取近作与评论样本，推断观众/粉丝画像、归类作品集并生成选题方案。画像为公开数据推断，非创作者中心官方数据。"
            title="账号分析中"
            type="info"
          />
        ) : null}

        {selectedAccount ? (
          <Surface title="账号资料">
            <Flexbox gap={14} horizontal style={{ alignItems: 'flex-start' }}>
              <Avatar
                avatar={selectedAccount.avatarUrl ?? undefined}
                size={64}
                title={selectedAccount.nickname}
              />
              <Flexbox gap={6} style={{ minWidth: 0, flex: 1 }}>
                <Flexbox gap={8} horizontal style={{ alignItems: 'center' }} wrap="wrap">
                  <Text weight={600}>{selectedAccount.nickname}</Text>
                  {selectedAccount.isActive ? <Tag>当前账号</Tag> : null}
                  {diagnosis ? <Tag color="info">{diagnosis.stageLabel}</Tag> : null}
                </Flexbox>
                <Text type="secondary">
                  抖音号 {selectedAccount.uniqueId || '未知'}
                  {selectedAccount.uid ? ` · UID ${selectedAccount.uid}` : ''}
                </Text>
                <Text type="secondary" ellipsis={{ rows: 2, tooltip: true }}>
                  {selectedAccount.signature || '暂无简介'}
                </Text>
                <Flexbox gap={16} horizontal wrap="wrap">
                  <Text>粉丝 {formatCount(selectedAccount.followerCount)}</Text>
                  <Text>作品 {formatCount(selectedAccount.awemeCount)}</Text>
                  <Text>获赞 {formatCount(selectedAccount.totalFavorited)}</Text>
                  {selectedAccount.profileUrl ? (
                    <Button
                      icon={ExternalLink}
                      size="small"
                      type="text"
                      onClick={() => {
                        window.open(selectedAccount.profileUrl!, '_blank', 'noreferrer')
                      }}
                    >
                      主页
                    </Button>
                  ) : null}
                </Flexbox>
              </Flexbox>
            </Flexbox>
          </Surface>
        ) : null}

        {!analysis && !analyzing ? (
          <div className="section-empty">
            {loading ? (
              <Text type="secondary">正在读取缓存…</Text>
            ) : (
              <Empty
                description="开始分析后会缓存结果；再次进入不重复请求。画像来自公开作品与评论推断。"
                icon={ChartColumn}
                title="还没有账号分析结果"
                action={
                  <Button
                    icon={Play}
                    type="primary"
                    onClick={() => {
                      void analyze()
                    }}
                  >
                    开始分析
                  </Button>
                }
              />
            )}
          </div>
        ) : null}

        {analysis && diagnosis ? (
          <div className="account-stage-fold">
            <button
              className="account-stage-fold__trigger"
              type="button"
              onClick={() => {
                setStageOpen((open) => !open)
              }}
            >
              <Flexbox gap={8} horizontal style={{ alignItems: 'center', minWidth: 0, flex: 1 }}>
                <Text weight={600}>账号阶段说明</Text>
                <Tag color="info">{diagnosis.stageLabel}</Tag>
                {!stageOpen ? (
                  <Text type="secondary" ellipsis style={{ minWidth: 0, flex: 1 }}>
                    {diagnosis.positioning}
                  </Text>
                ) : null}
              </Flexbox>
              {stageOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {stageOpen ? (
              <div className="account-stage-fold__body">
                <Text>{diagnosis.positioning}</Text>
                <ul className="account-analysis-list">
                  <li>
                    <Text weight={500}>发布节奏：</Text>
                    {diagnosis.postingCadence}
                  </li>
                  <li>
                    <Text weight={500}>时长：</Text>
                    {diagnosis.durationInsight}
                  </li>
                  {diagnosis.trackAlignment ? (
                    <li>
                      <Text weight={500}>赛道对齐：</Text>
                      {diagnosis.trackAlignment}
                    </li>
                  ) : null}
                  {diagnosis.strengths.map((item) => (
                    <li key={`s-${item}`}>优势：{item}</li>
                  ))}
                  {diagnosis.weaknesses.map((item) => (
                    <li key={`w-${item}`}>问题：{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {portrait ? (
          <>
            <Text type="secondary">{portrait.note}</Text>
            <div className="account-portrait-pair">
              <PortraitPanel title="推断观众画像" block={portrait.audience} />
              <PortraitPanel title="推断粉丝画像" block={portrait.fans} />
            </div>
          </>
        ) : null}

        {analysis ? (
          <>
            <Flexbox gap={4}>
              <Text weight={600}>作品列表</Text>
              <Text type="secondary">
                可按作品集查看，或切换全部列表；未拆解点「分析」，已缓存的显示「详情」。
              </Text>
            </Flexbox>
            <Segmented<WorksTab>
              options={[
                { label: '按作品集', value: 'collections' },
                { label: '全部列表', value: 'all' },
              ]}
              value={worksTab}
              onChange={(value) => {
                setWorksTab(value)
              }}
            />

            {worksTab === 'collections' ? (
              collections.length === 0 ? (
                <Empty description="重新分析后会生成作品集归类。" title="暂无作品集" />
              ) : (
                <Flexbox gap={16}>
                  {collections.map((item: AccountWorkCollection) => {
                    const rows = videos.filter((video) => item.awemeIds.includes(video.awemeId))
                    return (
                      <Flexbox key={item.id} gap={8}>
                        <Flexbox gap={8} horizontal style={{ alignItems: 'center' }} wrap="wrap">
                          <Text weight={600}>
                            {item.name} · {String(item.share)}%
                          </Text>
                          <Text type="secondary">{item.audienceHint}</Text>
                          <Text type="secondary">{String(rows.length)} 条</Text>
                        </Flexbox>
                        <Table<AccountAnalysisVideoRow>
                          className="table-with-pager"
                          columns={videoColumns}
                          dataSource={rows}
                          pagination={tablePagination(5)}
                          rowKey="awemeId"
                          variant="filled"
                        />
                      </Flexbox>
                    )
                  })}
                </Flexbox>
              )
            ) : (
              <Table<AccountAnalysisVideoRow>
                className="table-with-pager"
                columns={videoColumns}
                dataSource={videos}
                pagination={tablePagination(10)}
                rowKey="awemeId"
                variant="filled"
              />
            )}
          </>
        ) : null}

        {analysis && topicPlans.length > 0 ? (
          <>
            <Flexbox gap={4}>
              <Text weight={600}>选题方案</Text>
              <Text type="secondary">结合画像与近作表现推荐下一阶段选题及针对人群。</Text>
            </Flexbox>
            <Table<AccountTopicPlan>
              className="table-with-pager"
              columns={[
                {
                  title: '选题',
                  dataIndex: 'title',
                  key: 'title',
                },
                {
                  title: '针对人群',
                  dataIndex: 'targetAudience',
                  key: 'audience',
                  width: 220,
                },
                {
                  title: '理由',
                  key: 'reason',
                  render: (_: unknown, row) => (
                    <Flexbox gap={2}>
                      <Text>{row.reason}</Text>
                      {row.evidence.length > 0 ? (
                        <Text type="secondary">{row.evidence.join(' · ')}</Text>
                      ) : null}
                    </Flexbox>
                  ),
                },
                {
                  title: '操作',
                  key: 'action',
                  width: 120,
                  render: (_: unknown, row) => (
                    <Button
                      icon={Plus}
                      loading={addingTopicId === row.id}
                      size="small"
                      type="primary"
                      onClick={() => {
                        void addTopic(row)
                      }}
                    >
                      加选题
                    </Button>
                  ),
                },
              ]}
              dataSource={topicPlans}
              pagination={false}
              rowKey="id"
              variant="filled"
            />
          </>
        ) : null}
      </div>
    </div>
  )
}
