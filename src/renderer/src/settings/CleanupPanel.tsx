import { Alert, Button, Flexbox, Segmented, Text, toast } from '@lobehub/ui'
import { useCallback, useEffect, useState } from 'react'

import type { CleanupStatus, CleanupUsageKeepDays } from '../../../shared/cleanup'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function CleanupPanel() {
  const [status, setStatus] = useState<CleanupStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [keepDays, setKeepDays] = useState<'30' | '90'>('30')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      if (!window.studio?.cleanup?.getStatus) {
        throw new Error('清理接口未注入，请完全退出并重新启动应用后再试')
      }
      const next = await window.studio.cleanup.getStatus()
      setStatus(next)
      setError(null)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '无法读取可清理资源')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function runAction(
    key: string,
    title: string,
    action: () => Promise<{ freedBytes: number; detail: string; relaunching?: boolean }>,
  ): Promise<void> {
    setBusy(key)
    try {
      const result = await action()
      toast.success({
        title,
        description: `${result.detail}${result.freedBytes > 0 ? ` · 约释放 ${formatBytes(result.freedBytes)}` : ''}`,
      })
      if (!result.relaunching) await refresh()
    } catch (reason: unknown) {
      toast.error({
        title: `${title}失败`,
        description: reason instanceof Error ? reason.message : '操作失败',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="settings-body">
      <div className="page-stack">
        {error ? <Alert description={error} title="无法读取占用" type="error" /> : null}

        <div className="cleanup-overview">
          <Text type="secondary">数据库</Text>
          <Text code>{status?.databasePath ?? (loading ? '正在读取…' : '路径未知')}</Text>
          <Text type="secondary">库文件约 {formatBytes(status?.databaseBytes ?? 0)}</Text>
        </div>

        <section className="cleanup-section">
          <div className="cleanup-section-head">
            <div>
              <Text weight={600}>数据清理</Text>
              <Text as="div" type="secondary">
                一键清空本地 SQLite 里的业务数据（账号、选题、拆解、脚本、赛道自测、API 配置与用量等）。不会删除视频缓存与 Whisper 模型，也不会重启应用。
              </Text>
            </div>
            <Text weight={600}>{formatBytes(status?.databaseBytes ?? 0)}</Text>
          </div>
          <Alert
            description="此操作不可恢复。如需保留数据，请先到「数据备份」导出。"
            title="危险操作"
            type="warning"
          />
          <div className="cleanup-actions">
            <Button
              danger
              disabled={!status || status.databaseBytes <= 0}
              loading={busy === 'sqlite'}
              onClick={() => {
                void runAction('sqlite', '已清空本地数据', async () => {
                  const result = await window.studio.cleanup.clearSqliteData()
                  window.setTimeout(() => {
                    window.location.hash = '#/workbench'
                    window.location.reload()
                  }, 400)
                  return result
                })
              }}
            >
              一键清空 SQLite 数据
            </Button>
          </div>
        </section>

        <section className="cleanup-section">
          <div className="cleanup-section-head">
            <div>
              <Text weight={600}>Electron 运行缓存</Text>
              <Text as="div" type="secondary">
                Cache / Code Cache / GPU·Shader 等，对业务零依赖，关闭应用后清理更彻底。
              </Text>
            </div>
            <Text weight={600}>{formatBytes(status?.electronCache.bytes ?? 0)}</Text>
          </div>
          {status && status.electronCache.items.length > 0 ? (
            <ul className="cleanup-size-list">
              {status.electronCache.items.map((item) => (
                <li key={item.key}>
                  <span>{item.label}</span>
                  <span>{formatBytes(item.bytes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Text type="secondary">{loading ? '统计中…' : '暂无缓存目录'}</Text>
          )}
          <div className="cleanup-actions">
            <Button
              disabled={!status || (status.electronCache.bytes <= 0 && status.electronCache.items.length === 0)}
              loading={busy === 'electron'}
              onClick={() => {
                void runAction('electron', '已清理运行缓存', () =>
                  window.studio.cleanup.clearElectronCache(),
                )
              }}
            >
              清理运行缓存
            </Button>
          </div>
        </section>

        <section className="cleanup-section">
          <div className="cleanup-section-head">
            <div>
              <Text weight={600}>API 用量日志</Text>
              <Text as="div" type="secondary">
                仅影响「API用量记录」页的历史曲线，不影响分析结果。
              </Text>
            </div>
            <Text weight={600}>{formatBytes(status?.usageLogs.bytes ?? 0)}</Text>
          </div>
          <Flexbox gap={4}>
            <Text type="secondary">
              TikHub {status?.usageLogs.tikhubRows ?? 0} 条 · 大模型 {status?.usageLogs.llmRows ?? 0}{' '}
              条 · 最早 {formatTime(status?.usageLogs.oldestAt ?? null)}
            </Text>
            <Segmented
              options={[
                { label: '保留 30 天', value: '30' },
                { label: '保留 90 天', value: '90' },
              ]}
              value={keepDays}
              onChange={(value) => {
                setKeepDays(value === '90' ? '90' : '30')
              }}
            />
          </Flexbox>
          <div className="cleanup-actions">
            <Button
              disabled={!status || status.usageLogs.tikhubRows + status.usageLogs.llmRows <= 0}
              loading={busy === 'usage'}
              onClick={() => {
                const days = Number(keepDays) as CleanupUsageKeepDays
                void runAction('usage', '已清理用量日志', () =>
                  window.studio.cleanup.clearUsageLogs(days),
                )
              }}
            >
              删除更早记录
            </Button>
          </div>
        </section>

        <section className="cleanup-section">
          <div className="cleanup-section-head">
            <div>
              <Text weight={600}>本地视频缓存</Text>
              <Text as="div" type="secondary">
                按需下载的抖音 MP4（userData/media）。清理后播放与真实拆解会重新下载。
              </Text>
            </div>
            <Text weight={600}>{formatBytes(status?.mediaCache.bytes ?? 0)}</Text>
          </div>
          <Text type="secondary">
            {status?.mediaCache.fileCount ?? 0} 个文件
            {status?.mediaCache.path ? ` · ${status.mediaCache.path}` : ''}
          </Text>
          <div className="cleanup-actions">
            <Button
              disabled={!status || status.mediaCache.bytes <= 0}
              loading={busy === 'media'}
              onClick={() => {
                void runAction('media', '已清理本地视频缓存', () =>
                  window.studio.cleanup.clearMediaCache(),
                )
              }}
            >
              清理视频缓存
            </Button>
          </div>
        </section>

        <section className="cleanup-section">
          <div className="cleanup-section-head">
            <div>
              <Text weight={600}>可重建分析缓存</Text>
              <Text as="div" type="secondary">
                清空单视频分析/评论缓存、样本拆解正文、账号原始 JSON；下次打开会重新拉取或再跑模型。
              </Text>
            </div>
            <Text weight={600}>{formatBytes(status?.analysisCache.bytes ?? 0)}</Text>
          </div>
          <ul className="cleanup-size-list">
            <li>
              <span>单视频分析缓存（{status?.analysisCache.videoAnalysisCount ?? 0}）</span>
              <span>{formatBytes(status?.analysisCache.videoAnalysisBytes ?? 0)}</span>
            </li>
            <li>
              <span>样本拆解正文（{status?.analysisCache.researchVideoCount ?? 0} 条视频）</span>
              <span>{formatBytes(status?.analysisCache.breakdownBytes ?? 0)}</span>
            </li>
            <li>
              <span>账号 raw_json（{status?.analysisCache.accountRawCount ?? 0}）</span>
              <span>{formatBytes(status?.analysisCache.rawJsonBytes ?? 0)}</span>
            </li>
          </ul>
          <div className="cleanup-actions">
            <Button
              danger
              disabled={!status || status.analysisCache.bytes <= 0}
              loading={busy === 'analysis'}
              onClick={() => {
                void runAction('analysis', '已清理分析缓存', () =>
                  window.studio.cleanup.clearAnalysisCache(),
                )
              }}
            >
              清理分析缓存
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}