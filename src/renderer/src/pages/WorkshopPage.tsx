import { Button, Empty, Flexbox, Table, Tag, Text, toast } from '@lobehub/ui'
import { Section } from '@lobehub/ui/dashboard'
import { PenLine, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { WorkshopScriptSummary } from '../../../shared/workshop'
import { navigate, researchVideoHref, workshopScriptHref } from '../routes'
import { getStudio } from '../studioApi'
import { tablePagination } from '../tablePagination'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
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

function statusTag(status: WorkshopScriptSummary['status']) {
  switch (status) {
    case 'ready':
      return <Tag>已生成</Tag>
    case 'generating':
      return <Tag>生成中</Tag>
    case 'error':
      return <Tag>失败</Tag>
    default:
      return <Tag>草稿</Tag>
  }
}

function shortText(value: string, max = 42): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

export function WorkshopPage() {
  const [scripts, setScripts] = useState<WorkshopScriptSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setScripts(await getStudio().workshop.listScripts())
    } catch (error) {
      toast.error({ title: '读取创作工坊失败', description: errorMessage(error) })
      setScripts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (row: WorkshopScriptSummary) => {
    try {
      await getStudio().workshop.deleteScript(row.id)
      setScripts((prev) => prev.filter((item) => item.id !== row.id))
      toast.success({ title: '已删除脚本' })
    } catch (error) {
      toast.error({ title: '删除失败', description: errorMessage(error) })
    }
  }

  if (loading || scripts.length === 0) {
    return (
      <div className="page">
        <div className="page-empty">
          {loading ? (
            <Text type="secondary">正在加载脚本…</Text>
          ) : (
            <Empty
              description="在样本详情点「复刻脚本」，AI 会按原片思路仿写一版可拍口播。"
              icon={PenLine}
              title="还没有脚本"
              action={
                <Button type="primary" onClick={() => navigate('/research')}>
                  去样本拆解
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
      <div className="page-stack">
        <Section title="创作工坊">
          <Table<WorkshopScriptSummary>
            className="table-with-pager table-headers-nowrap"
            columns={[
              {
                title: '脚本',
                key: 'title',
                ellipsis: true,
                render: (_: unknown, row) => (
                  <div className="workshop-script-cell" title={row.title}>
                    <div className="workshop-script-cell__title">{shortText(row.title, 36)}</div>
                    <div className="workshop-script-cell__meta">
                      {row.sourceTitle
                        ? `来源：${shortText(row.sourceTitle, 28)}`
                        : shortText(row.angle || '—', 28)}
                    </div>
                  </div>
                ),
              },
              {
                title: '选题',
                key: 'topic',
                width: 140,
                ellipsis: true,
                render: (_: unknown, row) => (
                  <Text type="secondary" ellipsis>
                    {row.topicTitle || '—'}
                  </Text>
                ),
              },
              {
                title: '类型',
                key: 'type',
                width: 88,
                render: (_: unknown, row) => <Tag>{row.videoType || '其他'}</Tag>,
              },
              {
                title: '段数',
                key: 'segments',
                width: 64,
                align: 'right' as const,
                render: (_: unknown, row) => String(row.segmentCount),
              },
              {
                title: '状态',
                key: 'status',
                width: 88,
                render: (_: unknown, row) => statusTag(row.status),
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
                width: 210,
                render: (_: unknown, row) => (
                  <Flexbox gap={6} horizontal>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => {
                        navigate(workshopScriptHref(row.id))
                      }}
                    >
                      打开
                    </Button>
                    {row.sourceResearchVideoId ? (
                      <Button
                        size="small"
                        type="text"
                        onClick={() => {
                          navigate(researchVideoHref(row.sourceResearchVideoId!))
                        }}
                      >
                        原拆解
                      </Button>
                    ) : null}
                    <Button
                      danger
                      icon={Trash2}
                      size="small"
                      type="text"
                      onClick={() => {
                        void remove(row)
                      }}
                    >
                      删除
                    </Button>
                  </Flexbox>
                ),
              },
            ]}
            dataSource={scripts}
            pagination={tablePagination(10)}
            rowKey="id"
            size="small"
            variant="filled"
          />
        </Section>
      </div>
    </div>
  )
}
