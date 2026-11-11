import {
  Alert,
  Avatar,
  Button,
  Empty,
  Flexbox,
  Modal,
  Progress,
  Select,
  Spin,
  Table,
  Tag,
  Text,
  toast,
} from '@lobehub/ui'
import { Section } from '@lobehub/ui/dashboard'
import { Compass, ExternalLink, History, Play, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { DouyinAccount } from '../../../shared/tikhub'
import type {
  TrackAssessment,
  TrackAssessmentSummary,
  TrackCandidate,
  TrackInfluencer,
} from '../../../shared/track'
import { navigate } from '../routes'
import { getStudio } from '../studioApi'
import { tablePagination } from '../tablePagination'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}

function statusLabel(status: TrackAssessment['status']): string {
  switch (status) {
    case 'running':
      return '分析中'
    case 'ready':
      return '已完成'
    case 'failed':
      return '失败'
    default:
      return status
  }
}

function formatCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '—'
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}亿`
  if (count >= 10_000) return `${(count / 10_000).toFixed(count >= 100_000 ? 0 : 1)}万`
  return String(Math.round(count))
}

function formatFollowers(count: number): string {
  return formatCount(count)
}

function candidateMetrics(row: TrackCandidate) {
  return (
    row.metrics ?? {
      avgPlayCount: Math.max(0, row.heatScore),
      totalPlayCount: Math.max(0, row.heatScore),
      sampleVideoCount: 0,
      creatorCount: 0,
      playPerCreator: Math.max(0, row.competitionScore),
      avgDiggCount: 0,
      potentialScore: row.potentialScore,
    }
  )
}

export function TrackPage() {
  const [accounts, setAccounts] = useState<DouyinAccount[]>([])
  const [accountId, setAccountId] = useState<string>('')
  const [summaries, setSummaries] = useState<TrackAssessmentSummary[]>([])
  const [current, setCurrent] = useState<TrackAssessment | null>(null)
  const [detail, setDetail] = useState<TrackCandidate | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [refreshingMarket, setRefreshingMarket] = useState(false)
  /** 正在查看的详情 id；关闭后置空，避免校准请求回来又把弹窗打开 */
  const openDetailIdRef = useRef<string | null>(null)

  const bootstrap = useCallback(async () => {
    const studio = getStudio()
    const nextAccounts = await studio.tikhub.listAccounts()
    setAccounts(nextAccounts)

    const activeId =
      nextAccounts.find((item) => item.isActive)?.id || nextAccounts[0]?.id || ''
    setAccountId(activeId)

    if (!activeId) {
      setSummaries([])
      setCurrent(null)
      return
    }

    const nextSummaries = await studio.track.listAssessments(activeId)
    setSummaries(nextSummaries)
    const focusId =
      nextSummaries.find((item) => item.status === 'ready')?.id || nextSummaries[0]?.id
    // 进入页面只读本地结果，不触发市场校准，避免「像又在自测」
    setCurrent(focusId ? await studio.track.getAssessment(focusId, { enrich: false }) : null)
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        await bootstrap()
      } catch (error) {
        toast.error({ title: '读取赛道自测失败', description: errorMessage(error) })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [bootstrap])

  const accountOptions = useMemo(
    () =>
      accounts.map((item) => ({
        label: item.isActive ? `${item.nickname}（当前）` : item.nickname,
        value: item.id,
      })),
    [accounts],
  )

  const closeDetail = () => {
    openDetailIdRef.current = null
    setDetail(null)
  }

  const loadAccount = async (nextId: string) => {
    closeDetail()
    setAccountId(nextId)
    setLoading(true)
    try {
      const studio = getStudio()
      const nextSummaries = await studio.track.listAssessments(nextId)
      setSummaries(nextSummaries)
      const focusId =
        nextSummaries.find((item) => item.status === 'ready')?.id || nextSummaries[0]?.id
      setCurrent(focusId ? await studio.track.getAssessment(focusId, { enrich: false }) : null)
    } catch (error) {
      toast.error({ title: '切换账号失败', description: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  const startAssessment = async () => {
    if (!accountId) {
      toast.error({ title: '请先绑定抖音账号' })
      return
    }
    closeDetail()
    setRunning(true)
    try {
      const assessment = await getStudio().track.startAssessment(accountId)
      setCurrent(assessment)
      const nextSummaries = await getStudio().track.listAssessments(accountId)
      setSummaries(nextSummaries)
      if (assessment.status === 'failed') {
        toast.error({ title: '自测失败', description: assessment.error || '分析未完成' })
      } else {
        toast.success({
          title: '自测完成',
          description: '已生成细分赛道（大模型可用时增强，否则走本地算法），可添加进样本拆解。',
        })
      }
    } catch (error) {
      toast.error({ title: '开始自测失败', description: errorMessage(error) })
    } finally {
      setRunning(false)
    }
  }

  const openSummary = async (id: string) => {
    closeDetail()
    setRefreshingMarket(true)
    try {
      const assessment = await getStudio().track.getAssessment(id)
      setCurrent(assessment)
    } catch (error) {
      toast.error({ title: '读取记录失败', description: errorMessage(error) })
    } finally {
      setRefreshingMarket(false)
    }
  }

  const openDetail = async (candidate: TrackCandidate) => {
    openDetailIdRef.current = candidate.id
    setDetail(candidate)
    if (!current) return
    setRefreshingMarket(true)
    try {
      const assessment = await getStudio().track.getAssessment(current.id)
      setCurrent(assessment)
      // 用户已关闭弹窗则不再写回，避免校准完成后又弹出来
      if (openDetailIdRef.current !== candidate.id) return
      const fresh = assessment.candidates.find((item) => item.id === candidate.id)
      if (fresh) setDetail(fresh)
    } catch (error) {
      if (openDetailIdRef.current === candidate.id) {
        toast.error({ title: '校准市场数据失败', description: errorMessage(error) })
      }
    } finally {
      setRefreshingMarket(false)
    }
  }

  const addTopic = async (candidate: TrackCandidate) => {
    if (!current || candidate.addedAsTopic) return
    setAddingId(candidate.id)
    try {
      await getStudio().topic.addFromTrack(current.id, candidate.id)
      const next = await getStudio().track.getAssessment(current.id)
      setCurrent(next)
      setDetail((prev) =>
        prev && prev.id === candidate.id ? { ...prev, addedAsTopic: true } : prev,
      )
      toast.success({
        title: '已添加选题',
        description: `${candidate.name} · 可在样本拆解继续拆解`,
      })
    } catch (error) {
      toast.error({ title: '添加失败', description: errorMessage(error) })
    } finally {
      setAddingId(null)
    }
  }

  const removeAssessment = async (id: string) => {
    try {
      await getStudio().track.deleteAssessment(id)
      toast.success({ title: '已删除自测记录' })
      const nextSummaries = await getStudio().track.listAssessments(accountId)
      setSummaries(nextSummaries)
      if (current?.id === id) {
        const focusId = nextSummaries[0]?.id
        setCurrent(
          focusId ? await getStudio().track.getAssessment(focusId, { enrich: false }) : null,
        )
      }
    } catch (error) {
      toast.error({ title: '删除失败', description: errorMessage(error) })
    }
  }

  return (
    <div className="page">
      {accounts.length > 0 ? (
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
            icon={Play}
            loading={running}
            type="primary"
            onClick={() => {
              void startAssessment()
            }}
          >
            {running ? '自测中' : current ? '重新自测' : '开始自测'}
          </Button>
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <div className="page-empty">
          {loading ? (
            <Text type="secondary">正在加载…</Text>
          ) : (
            <Empty
              description="赛道自测需要先绑定抖音账号。"
              icon={Compass}
              title="还没有可分析的账号"
              action={
                <Button
                  type="primary"
                  onClick={() => {
                    navigate('/settings/accounts')
                  }}
                >
                  去账号管理
                </Button>
              }
            />
          )}
        </div>
      ) : (
      <div className="page-stack">
            {running ? (
              <div className="page-empty">
                <div className="research-loading">
                  <Spin size="large" />
                  <Text weight={600}>正在自测赛道</Text>
                  <Text type="secondary">
                    拉取近作、生成细分赛道，并搜索抖音校准热度、竞争、潜力与代表红人…
                  </Text>
                </div>
              </div>
            ) : (
              <>
                {refreshingMarket ? (
                  <Alert
                    description="正在用抖音搜索校准热度、竞争、潜力与真实代表红人，请稍候。"
                    title="校准市场数据"
                    type="info"
                  />
                ) : null}

                {current ? (
                  <AssessmentResult
                    addingId={addingId}
                    assessment={current}
                    onAddTopic={addTopic}
                    onOpenDetail={(candidate) => {
                      void openDetail(candidate)
                    }}
                  />
                ) : loading ? (
                  <Text type="secondary">正在读取上次自测结果…</Text>
                ) : (
                  <div className="section-empty">
                    <Empty
                      description="选择账号后开始自测，将先拆成分再给细分赛道。"
                      icon={Compass}
                      title="还没有自测结果"
                    />
                  </div>
                )}
              </>
            )}

            <Section title="历史记录">
              {summaries.length === 0 ? (
                <div className="section-empty">
                  <Empty
                    description="开始一次自测后，结果会留在这里。"
                    icon={History}
                    title="还没有历史记录"
                  />
                </div>
              ) : (
                <Table<TrackAssessmentSummary>
                  columns={[
                    {
                      title: '时间',
                      key: 'updatedAt',
                      width: 168,
                      render: (_: unknown, row) => formatTime(row.updatedAt),
                    },
                    {
                      title: '状态',
                      key: 'status',
                      width: 88,
                      render: (_: unknown, row) => <Tag>{statusLabel(row.status)}</Tag>,
                    },
                    {
                      title: '候选',
                      key: 'candidateCount',
                      width: 72,
                      render: (_: unknown, row) => `${String(row.candidateCount)} 条`,
                    },
                    {
                      title: '操作',
                      key: 'actions',
                      width: 120,
                      render: (_: unknown, row) => (
                        <Flexbox gap={4} horizontal>
                          <Button size="small" type="text" onClick={() => void openSummary(row.id)}>
                            查看
                          </Button>
                          <Button
                            danger
                            icon={Trash2}
                            size="small"
                            type="text"
                            onClick={() => void removeAssessment(row.id)}
                          />
                        </Flexbox>
                      ),
                    },
                  ]}
                  dataSource={summaries}
                  pagination={tablePagination(5)}
                  rowKey="id"
                  size="small"
                  variant="filled"
                  className="table-with-pager"
                />
              )}
            </Section>
      </div>
      )}

      <Modal
        destroyOnHidden
        footer={
          detail ? (
            <Flexbox gap={8} horizontal style={{ justifyContent: 'flex-end' }}>
              <Button
                disabled={detail.addedAsTopic}
                icon={Plus}
                loading={addingId === detail.id}
                type="primary"
                onClick={() => {
                  void addTopic(detail)
                }}
              >
                {detail.addedAsTopic ? '已在选题中' : '添加选题'}
              </Button>
            </Flexbox>
          ) : null
        }
        open={Boolean(detail)}
        title={detail ? detail.name : '赛道详情'}
        width={720}
        onCancel={closeDetail}
      >
        {detail ? <CandidateDetail candidate={detail} /> : null}
      </Modal>
    </div>
  )
}

function AssessmentResult({
  assessment,
  addingId,
  onOpenDetail,
  onAddTopic,
}: {
  assessment: TrackAssessment
  addingId: string | null
  onOpenDetail: (candidate: TrackCandidate) => void
  onAddTopic: (candidate: TrackCandidate) => void
}) {
  if (assessment.status === 'failed') {
    return (
      <Alert
        description={assessment.error || '请稍后重试'}
        title="这次自测失败了"
        type="error"
      />
    )
  }

  if (assessment.status === 'running') {
    return (
      <Section title="分析中">
        <Progress percent={60} />
        <Text type="secondary">正在拆解账号内容成分与细分赛道…</Text>
      </Section>
    )
  }

  const diagnosis = assessment.diagnosis

  return (
    <>
      <Flexbox gap={12} horizontal style={{ alignItems: 'flex-start' }}>
        <Avatar
          avatar={assessment.accountAvatarUrl ?? undefined}
          size={44}
          title={assessment.accountNickname}
        />
        <Flexbox gap={8} style={{ minWidth: 0, flex: 1 }}>
          <Text ellipsis={{ rows: 2, tooltip: true }}>
            {diagnosis?.positioning || '暂无定位摘要'}
          </Text>
          {diagnosis && diagnosis.composition.length > 0 ? (
            <Flexbox gap={6} horizontal wrap="wrap">
              {diagnosis.composition.map((item) => (
                <Tag key={`${item.label}-${item.signal}`}>
                  {item.label} {String(item.share)}%
                </Tag>
              ))}
            </Flexbox>
          ) : null}
          {diagnosis ? (
            <Text type="secondary" ellipsis={{ rows: 1, tooltip: true }}>
              优势：{diagnosis.strengths.slice(0, 2).join('；')}
            </Text>
          ) : null}
        </Flexbox>
        <Tag>{statusLabel(assessment.status)}</Tag>
      </Flexbox>

      <Section
        desc="按账号成分生成细分赛道；浏览量为抖音搜索本页样本均播，潜力为同批相对分。"
        title="推荐赛道"
      >
        <Table<TrackCandidate>
          columns={[
            {
              title: '赛道',
              key: 'name',
              render: (_: unknown, row) => (
                <Flexbox gap={2}>
                  <Text weight={500}>{row.name}</Text>
                  <Text type="secondary" ellipsis={{ rows: 1, tooltip: true }}>
                    {row.summary}
                  </Text>
                </Flexbox>
              ),
            },
            {
              title: '浏览量',
              key: 'avgPlay',
              width: 88,
              align: 'right' as const,
              render: (_: unknown, row) => {
                const m = candidateMetrics(row)
                return (
                  <Flexbox gap={0} style={{ alignItems: 'flex-end' }}>
                    <Text weight={500}>{formatCount(m.avgPlayCount)}</Text>
                    <Text fontSize={11} type="secondary">
                      均播
                    </Text>
                  </Flexbox>
                )
              },
            },
            {
              title: '潜力',
              key: 'potential',
              width: 72,
              align: 'right' as const,
              render: (_: unknown, row) => {
                const m = candidateMetrics(row)
                return m.potentialScore > 0 ? String(m.potentialScore) : '—'
              },
            },
            {
              title: '操作',
              key: 'actions',
              width: 168,
              render: (_: unknown, row) => (
                <Flexbox gap={4} horizontal>
                  <Button size="small" type="text" onClick={() => onOpenDetail(row)}>
                    详情
                  </Button>
                  <Button
                    disabled={row.addedAsTopic}
                    icon={Plus}
                    loading={addingId === row.id}
                    size="small"
                    type="primary"
                    onClick={() => {
                      onAddTopic(row)
                    }}
                  >
                    {row.addedAsTopic ? '已添加' : '添加'}
                  </Button>
                </Flexbox>
              ),
            },
          ]}
          dataSource={assessment.candidates}
          pagination={tablePagination(10)}
          rowKey="id"
          size="small"
          variant="filled"
          className="table-with-pager"
        />
      </Section>
    </>
  )
}

function CandidateDetail({ candidate }: { candidate: TrackCandidate }) {
  const metrics = candidateMetrics(candidate)
  return (
    <div className="page-stack">
      <Text>{candidate.summary}</Text>
      <Text type="secondary">{candidate.reason}</Text>
      <Flexbox gap={16} horizontal wrap="wrap">
        <Text>
          均播 <Text weight={500}>{formatCount(metrics.avgPlayCount)}</Text>
        </Text>
        <Text>
          样本作者 <Text weight={500}>{metrics.creatorCount > 0 ? String(metrics.creatorCount) : '—'}</Text>
        </Text>
        <Text>
          均赞 <Text weight={500}>{formatCount(metrics.avgDiggCount)}</Text>
        </Text>
        <Text>
          潜力 <Text weight={500}>{metrics.potentialScore}</Text>
        </Text>
      </Flexbox>
      <Text fontSize={12} type="secondary">
        缺播放量时用赞×25估播。潜力为同批相对分（约 28–92）。
      </Text>

      <Section title="数据支撑">
        {candidate.evidence.length > 0 ? (
          <ul className="track-evidence-list">
            {candidate.evidence.map((item) => (
              <li key={item}>
                <Text type="secondary">{item}</Text>
              </li>
            ))}
          </ul>
        ) : (
          <Text type="secondary">暂无检索到可引用的近作或搜索样本。</Text>
        )}
      </Section>

      <Section title="代表红人">
        {candidate.influencers.length > 0 ? (
          <div className="track-influencer-list">
            {candidate.influencers.map((item) => (
              <InfluencerCard key={`${item.nickname}-${item.uniqueId ?? ''}`} influencer={item} />
            ))}
          </div>
        ) : (
          <Text type="secondary">未检索到可对标的真实账号，请确认 TikHub 可用后重新自测。</Text>
        )}
      </Section>
    </div>
  )
}

function InfluencerCard({ influencer }: { influencer: TrackInfluencer }) {
  return (
    <div className="track-influencer-card">
      <Flexbox gap={12} horizontal style={{ alignItems: 'flex-start' }}>
        <Avatar
          avatar={influencer.avatarUrl ?? undefined}
          size={48}
          title={influencer.nickname}
        />
        <Flexbox gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Flexbox gap={8} horizontal style={{ alignItems: 'center' }} wrap="wrap">
            <Text weight={500}>{influencer.nickname}</Text>
            {influencer.uniqueId ? (
              <Text code type="secondary">
                @{influencer.uniqueId}
              </Text>
            ) : null}
          </Flexbox>
          <Text type="secondary" ellipsis={{ rows: 2, tooltip: true }}>
            {influencer.signature || influencer.highlight || '暂无简介'}
          </Text>
          <Text type="secondary">
            粉丝 {formatFollowers(influencer.followerCount)}
            {influencer.awemeCount > 0 ? ` · 作品 ${String(influencer.awemeCount)}` : ' · 作品 —'}
          </Text>
          {influencer.highlight && influencer.signature ? (
            <Text ellipsis={{ rows: 2, tooltip: true }}>{influencer.highlight}</Text>
          ) : null}
          <div>
            <a
              className="track-influencer-link"
              href={influencer.profileUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink size={14} />
              打开抖音主页
            </a>
          </div>
        </Flexbox>
      </Flexbox>
    </div>
  )
}
