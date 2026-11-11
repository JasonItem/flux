import { BarChart, BarList } from '@lobehub/charts'
import {
  Alert,
  Empty,
  Flexbox,
  Segmented,
  Table,
  Text,
  toast,
} from '@lobehub/ui'
import { MetricStrip, Surface } from '@lobehub/ui/dashboard'
import { Bot, KeyRound } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { LlmUsageRecord, LlmUsageStats } from '../../../shared/llm'
import type { TikHubCallRecord, TikHubUsageOverview } from '../../../shared/tikhub'
import { tablePagination } from '../tablePagination'

function shortDay(iso: string): string {
  const parts = iso.split('-')
  if (parts.length >= 3) return `${parts[1]}-${parts[2]}`
  return iso.slice(5)
}

type UsageTab = 'tikhub' | 'llm'

function formatUsd(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—'
  return `$${value.toFixed(2)}`
}

function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}

function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 3) return path
  return `…/${parts.slice(-3).join('/')}`
}

export function UsagePanel() {
  const [tab, setTab] = useState<UsageTab>('tikhub')
  const [loading, setLoading] = useState(true)
  const [tikhub, setTikhub] = useState<TikHubUsageOverview | null>(null)
  const [llmStats, setLlmStats] = useState<LlmUsageStats | null>(null)
  const [llmRows, setLlmRows] = useState<LlmUsageRecord[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextTikhub, nextStats, nextRows] = await Promise.all([
        window.studio.tikhub.getUsage(14),
        window.studio.llm.getUsageStats(14),
        window.studio.llm.listUsage(80),
      ])
      setTikhub(nextTikhub)
      setLlmStats(nextStats)
      setLlmRows(nextRows)
    } catch (error) {
      toast.error({
        title: '读取用量失败',
        description: error instanceof Error ? error.message : '操作失败',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="settings-body">
      <div className="usage-panel">
        <Flexbox gap={12} horizontal style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Segmented<UsageTab>
            options={[
              { icon: <KeyRound size={14} />, label: 'TikHub', value: 'tikhub' },
              { icon: <Bot size={14} />, label: '大模型', value: 'llm' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <Text type="secondary">{loading ? '刷新中…' : '近 14 天'}</Text>
        </Flexbox>

        {tab === 'tikhub' ? (
          <TikHubUsageSection data={tikhub} />
        ) : (
          <LlmUsageSection rows={llmRows} stats={llmStats} />
        )}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text as="h3" className="usage-section-title" weight={600}>
      {children}
    </Text>
  )
}

function TikHubUsageSection({ data }: { data: TikHubUsageOverview | null }) {
  if (!data) {
    return <Text type="secondary">正在读取 TikHub 用量…</Text>
  }

  const callColumns = [
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (value: string) => formatTime(value) },
    {
      title: '接口',
      dataIndex: 'path',
      key: 'path',
      render: (value: string) => shortPath(value),
    },
    {
      title: '状态',
      dataIndex: 'ok',
      key: 'ok',
      render: (ok: boolean, row: TikHubCallRecord) => (ok ? '成功' : row.message || '失败'),
    },
  ]

  const syncSoftFail = data.ready && data.message !== 'ok'

  return (
    <>
      {!data.ready ? (
        <Alert
          description="配置并启用 TikHub 后，可同步官方余额/今日用量，并记录本机抖音相关请求。"
          title="TikHub 尚未就绪"
          type="info"
        />
      ) : null}

      {syncSoftFail ? (
        <Alert
          description={data.message}
          title={data.balance !== undefined ? '官方用量暂用缓存' : '官方用量暂不可用'}
          type="info"
        />
      ) : null}

      <MetricStrip
        items={[
          {
            hint: 'TikHub 账户余额（USD）',
            label: '余额',
            mark: KeyRound,
            value: formatUsd(data.balance),
          },
          {
            hint: '免费额度（USD）',
            label: '赠额',
            value: formatUsd(data.freeCredit),
          },
          {
            hint: '优先官方今日请求；拿不到时用本机今日调用',
            label: '今日请求',
            value:
              data.todayRequests === undefined ? '—' : String(data.todayRequests),
          },
          {
            hint: '本机近 14 天抖音相关调用',
            label: '本机调用',
            value: String(data.totals.requests),
          },
        ]}
        variant="split"
      />

      <Surface title="本机调用趋势（次）">
        {data.series.some((item) => item.requests > 0) ? (
          <BarChart
            categories={['成功', '失败']}
            data={data.series.map((item) => ({
              date: shortDay(item.date),
              成功: item.successCount,
              失败: item.errorCount,
            }))}
            height={220}
            index="date"
            stack
            valueFormatter={(value) => `${String(value)} 次`}
          />
        ) : (
          <Text type="secondary">
            还没有本机 TikHub 调用记录。去账号管理拉取资料后会出现在这里。
          </Text>
        )}
        {data.todayCostUsd !== undefined ? (
          <Text type="secondary">官方今日消耗约 {formatUsd(data.todayCostUsd)} USD</Text>
        ) : null}
      </Surface>

      <div className="usage-table-block">
        <SectionTitle>最近本机调用</SectionTitle>
        <Table<TikHubCallRecord>
          columns={callColumns}
          dataSource={data.recentCalls}
          locale={{
            emptyText: (
              <Empty
                description="成功或失败的抖音接口调用都会记在这里（余额轮询不计入）。"
                title="暂无调用记录"
              />
            ),
          }}
          pagination={tablePagination(10)}
          rowKey="id"
          variant="filled"
        />
      </div>
    </>
  )
}

function LlmUsageSection({
  stats,
  rows,
}: {
  stats: LlmUsageStats | null
  rows: LlmUsageRecord[]
}) {
  if (!stats) {
    return <Text type="secondary">正在读取大模型用量…</Text>
  }

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: string) => formatTime(value),
    },
    { title: '渠道', dataIndex: 'providerName', key: 'providerName' },
    { title: '模型', dataIndex: 'modelName', key: 'modelName' },
    {
      title: '输入 tokens',
      dataIndex: 'promptTokens',
      key: 'promptTokens',
      render: (value: number | null) => formatTokens(value),
    },
    {
      title: '输出 tokens',
      dataIndex: 'completionTokens',
      key: 'completionTokens',
      render: (value: number | null) => formatTokens(value),
    },
    {
      title: '合计 tokens',
      dataIndex: 'totalTokens',
      key: 'totalTokens',
      render: (value: number | null) => formatTokens(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: string, row: LlmUsageRecord) =>
        value === 'success' ? '成功' : row.error || '失败',
    },
  ]

  return (
    <>
      <MetricStrip
        items={[
          {
            hint: '近 14 天合计 tokens',
            label: '总 Tokens',
            mark: Bot,
            value: formatTokens(stats.totals.totalTokens),
          },
          {
            hint: '提示词 / 输入',
            label: '输入',
            value: formatTokens(stats.totals.promptTokens),
          },
          {
            hint: '补全 / 输出',
            label: '输出',
            value: formatTokens(stats.totals.completionTokens),
          },
          {
            hint: `成功 ${String(stats.totals.successCount)} · 失败 ${String(stats.totals.errorCount)}`,
            label: '调用次数',
            value: String(stats.totals.requests),
          },
        ]}
        variant="split"
      />

      <Surface title="每日 Token 用量">
        {stats.days.some((item) => item.totalTokens > 0 || item.requests > 0) ? (
          <BarChart
            categories={['输入', '输出']}
            data={stats.days.map((item) => ({
              date: shortDay(item.date),
              输入: item.promptTokens,
              输出: item.completionTokens,
            }))}
            height={220}
            index="date"
            stack
            valueFormatter={(value) => formatTokens(value)}
          />
        ) : (
          <Text type="secondary">
            还没有大模型调用记录。在「大模型配置」里测试连通后会出现在这里。
          </Text>
        )}
      </Surface>

      {stats.byModel.length > 0 ? (
        <Surface title="按模型汇总（tokens）">
          <BarList
            data={stats.byModel.map((item) => ({
              name: item.modelName,
              value: item.totalTokens,
            }))}
            sortOrder="descending"
            valueFormatter={(value) => formatTokens(value)}
          />
        </Surface>
      ) : null}

      <div className="usage-table-block">
        <SectionTitle>最近调用明细</SectionTitle>
        <Table<LlmUsageRecord>
          columns={columns}
          dataSource={rows}
          locale={{
            emptyText: (
              <Empty
                description="每次成功或失败的聊天请求都会按 token 记一笔。"
                title="暂无大模型用量"
              />
            ),
          }}
          pagination={tablePagination(10)}
          rowKey="id"
          variant="filled"
        />
      </div>
    </>
  )
}
