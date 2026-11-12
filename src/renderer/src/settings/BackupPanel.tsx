import { Alert, Button, Text, toast } from '@lobehub/ui'
import { Download, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { BackupStatus } from '../../../shared/backup'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function BackupPanel() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      if (!window.studio?.backup?.getStatus) {
        throw new Error('备份接口未注入，请完全退出并重新启动应用后再试')
      }
      const next = await window.studio.backup.getStatus()
      setStatus(next)
      setError(null)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '无法读取备份状态')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const exportDatabase = async () => {
    setBusy('export')
    try {
      const result = await window.studio.backup.exportDatabase()
      if (result.canceled) return
      toast.success({
        title: '备份已导出',
        description: `${result.path ?? ''}${result.bytes > 0 ? ` · ${formatBytes(result.bytes)}` : ''}`,
      })
      await refresh()
    } catch (reason: unknown) {
      toast.error({
        title: '导出失败',
        description: reason instanceof Error ? reason.message : '导出失败',
      })
    } finally {
      setBusy(null)
    }
  }

  const importDatabase = async () => {
    setBusy('import')
    try {
      const result = await window.studio.backup.importDatabase()
      if (result.canceled) return
      toast.success({
        title: '备份已导入',
        description: `已导入 ${result.path ?? '备份文件'}，正在刷新界面…`,
      })
      window.setTimeout(() => {
        window.location.hash = '#/workbench'
        window.location.reload()
      }, 400)
    } catch (reason: unknown) {
      toast.error({
        title: '导入失败',
        description: reason instanceof Error ? reason.message : '导入失败',
      })
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="settings-body">
      <div className="page-stack">
        {error ? <Alert description={error} title="无法读取备份状态" type="error" /> : null}

        <Alert
          description="备份包含账号、选题、样本拆解、创作工坊脚本、赛道自测、大模型/TikHub 配置与用量记录。本地视频缓存与 Whisper 模型不在备份内，换机后会按需重新下载。"
          title="换机迁移"
          type="info"
        />

        <div className="cleanup-overview">
          <Text type="secondary">当前数据库</Text>
          <Text code>{status?.databasePath ?? (loading ? '正在读取…' : '路径未知')}</Text>
          <Text type="secondary">
            约 {formatBytes(status?.databaseBytes ?? 0)} · schema v
            {String(status?.schemaVersion ?? 0)}
          </Text>
          <Text type="secondary">
            视频缓存 {formatBytes(status?.mediaBytes ?? 0)} · Whisper{' '}
            {formatBytes(status?.whisperBytes ?? 0)}（不纳入备份）
          </Text>
        </div>

        <section className="cleanup-section">
          <div className="cleanup-section-head">
            <div>
              <Text weight={600}>导出备份</Text>
              <Text as="div" type="secondary">
                生成一份可随身携带的 `.sqlite` 文件，拷到另一台电脑后再导入。
              </Text>
            </div>
          </div>
          <div className="cleanup-actions">
            <Button
              disabled={!status}
              icon={Download}
              loading={busy === 'export'}
              type="primary"
              onClick={() => {
                void exportDatabase()
              }}
            >
              导出数据备份
            </Button>
          </div>
        </section>

        <section className="cleanup-section">
          <div className="cleanup-section-head">
            <div>
              <Text weight={600}>导入备份</Text>
              <Text as="div" type="secondary">
                用备份覆盖本机数据。导入后会刷新界面加载新数据；建议先导出当前数据以防万一。
              </Text>
            </div>
          </div>
          <div className="cleanup-actions">
            <Button
              danger
              disabled={!status}
              icon={Upload}
              loading={busy === 'import'}
              onClick={() => {
                void importDatabase()
              }}
            >
              导入备份
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}