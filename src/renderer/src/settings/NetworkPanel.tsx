import {
  Alert,
  Button,
  Flexbox,
  Input,
  InputNumber,
  Progress,
  Select,
  Switch,
  Tag,
  Text,
  toast,
} from '@lobehub/ui'
import { Form, useForm } from '@lobehub/ui/form'
import { Cable, Download, Network, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type {
  NetworkProxySettings,
  ProxyProtocol,
  WhisperDepKey,
  WhisperDepsStatus,
} from '../../../shared/network'
import { NetworkProxyChangedEvent } from '../../../shared/network'

interface ProxyFormValues {
  enabled: boolean
  protocol: ProxyProtocol
  host: string
  port: number | null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function notifyProxyChanged(): void {
  window.dispatchEvent(new Event(NetworkProxyChangedEvent))
}

function platformLabel(platform: string | undefined): string {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform || '未知'
}

export function NetworkPanel() {
  const [loading, setLoading] = useState(true)
  const [proxy, setProxy] = useState<NetworkProxySettings | null>(null)
  const [deps, setDeps] = useState<WhisperDepsStatus | null>(null)
  const [depsError, setDepsError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [progressMessage, setProgressMessage] = useState<string | null>(null)
  const [progressPercent, setProgressPercent] = useState<number | undefined>(undefined)

  const form = useForm<ProxyFormValues>({
    initialValues: {
      enabled: false,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    },
    onSubmit: async (values) => {
      try {
        if (!window.studio?.network?.updateProxy) {
          throw new Error('网络接口未注入，请完全退出并重新启动应用后再试')
        }
        const next = await window.studio.network.updateProxy({
          enabled: values.enabled,
          protocol: values.protocol,
          host: values.host.trim(),
          port: values.port ?? 7890,
        })
        setProxy(next)
        notifyProxyChanged()
        toast.success({
          title: next.enabled ? '代理已启用' : '代理已关闭',
          description: next.enabled
            ? `${next.protocol}://${next.host}:${String(next.port)}`
            : '下载将直连网络',
        })
      } catch (error) {
        toast.error({ title: '保存代理失败', description: errorMessage(error) })
      }
    },
  })

  const refreshDeps = useCallback(async () => {
    try {
      if (!window.studio?.network?.getDepsStatus) {
        throw new Error('依赖接口未注入，请完全退出并重新启动应用后再试')
      }
      const next = await window.studio.network.getDepsStatus()
      setDeps(next)
      setDepsError(null)
    } catch (error) {
      setDepsError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!window.studio?.network?.getProxy) {
          throw new Error('网络接口未注入，请完全退出并重新启动应用后再试')
        }
        const next = await window.studio.network.getProxy()
        if (!active) return
        setProxy(next)
        form.reset({
          enabled: next.enabled,
          protocol: next.protocol,
          host: next.host,
          port: next.port,
        })
      } catch (error) {
        toast.error({ title: '读取代理配置失败', description: errorMessage(error) })
      } finally {
        if (active) setLoading(false)
      }
    })()
    void refreshDeps()
    return () => {
      active = false
    }
  }, [form, refreshDeps])

  useEffect(() => {
    if (!window.studio?.network?.onDepsProgress) return
    return window.studio.network.onDepsProgress((event) => {
      setProgressMessage(event.message)
      setProgressPercent(event.percent)
    })
  }, [])

  const depsBusy = busyKey !== null

  async function runInstall(key?: WhisperDepKey, force = false): Promise<void> {
    setBusyKey(key ?? 'all')
    setProgressMessage(force ? '正在重新下载…' : '准备下载…')
    setProgressPercent(0)
    try {
      const next = await window.studio.network.installDeps(
        key || force ? { key, force } : undefined,
      )
      setDeps(next)
      setDepsError(null)
      toast.success({
        title: force ? '已重新下载' : next.ready ? '依赖已就绪' : '下载完成',
        description: next.ready
          ? 'Win/Mac 均可继续拆解视频'
          : '部分依赖仍不可用，请查看下方状态',
      })
    } catch (error) {
      toast.error({
        title: force ? '重新下载失败' : '依赖下载失败',
        description: errorMessage(error),
      })
      await refreshDeps()
    } finally {
      setBusyKey(null)
      setProgressMessage(null)
      setProgressPercent(undefined)
    }
  }

  async function runRemove(key: WhisperDepKey, label: string): Promise<void> {
    setBusyKey(`remove:${key}`)
    try {
      const next = await window.studio.network.removeDep(key)
      setDeps(next)
      setDepsError(null)
      toast.success({ title: `已删除 ${label}`, description: '需要时可再点重新下载' })
    } catch (error) {
      toast.error({ title: '删除失败', description: errorMessage(error) })
      await refreshDeps()
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="settings-body">
      <div className="page-stack">
        <section className="cleanup-section">
          <div className="cleanup-section-head">
            <div>
              <Text weight={600}>网络代理</Text>
              <Text as="div" type="secondary">
                用于 Hugging Face / GitHub 等依赖下载。常见本机代理端口：Clash 7890、V2Ray 10809。
              </Text>
            </div>
            {proxy?.enabled ? (
              <Text weight={600}>
                {proxy.protocol}://{proxy.host}:{String(proxy.port)}
              </Text>
            ) : (
              <Text type="secondary">未启用</Text>
            )}
          </div>

          {loading ? (
            <Text type="secondary">正在读取配置…</Text>
          ) : (
            <Form
              footer={
                <Form.SubmitFooter
                  enableReset
                  texts={{
                    reset: '重置',
                    submit: '保存代理',
                    unSaved: '有未保存的更改',
                    unSavedWarning: '离开前请确认是否保存',
                  }}
                />
              }
              form={form}
              items={[
                {
                  children: [
                    {
                      children: <Switch />,
                      desc: '开启后，应用内下载与部分网络请求走此代理。',
                      label: '启用代理',
                      name: 'enabled',
                    },
                    {
                      children: (
                        <Select
                          options={[
                            { label: 'HTTP', value: 'http' },
                            { label: 'HTTPS', value: 'https' },
                            { label: 'SOCKS5', value: 'socks5' },
                          ]}
                        />
                      ),
                      label: '协议',
                      name: 'protocol',
                    },
                    {
                      children: <Input placeholder="127.0.0.1" />,
                      label: '主机',
                      name: 'host',
                    },
                    {
                      children: <InputNumber max={65535} min={1} step={1} />,
                      label: '端口',
                      name: 'port',
                    },
                  ],
                  icon: Network,
                  key: 'proxy',
                  title: '代理',
                },
              ]}
              layout="vertical"
            />
          )}
        </section>

        <section className="cleanup-section">
          <div className="cleanup-section-head">
            <div>
              <Text weight={600}>拆解依赖</Text>
              <Text as="div" type="secondary">
                Win / Mac 均可检测、单独删除与重新下载。FFmpeg 随安装包提供；引擎与模型可随时清理重下。
              </Text>
            </div>
            <Flexbox gap={8} horizontal>
              <Button
                disabled={depsBusy}
                icon={RefreshCw}
                type="text"
                onClick={() => {
                  void refreshDeps()
                }}
              >
                重新检测
              </Button>
              <Button
                disabled={depsBusy && busyKey !== 'all'}
                icon={Download}
                loading={busyKey === 'all'}
                type="primary"
                onClick={() => {
                  void runInstall(undefined, false)
                }}
              >
                下载缺失依赖
              </Button>
            </Flexbox>
          </div>

          {depsError ? <Alert description={depsError} title="无法检测依赖" type="error" /> : null}

          {depsBusy && busyKey !== null && !busyKey.startsWith('remove:') ? (
            <div className="cleanup-overview">
              <Text>{progressMessage ?? '下载中…'}</Text>
              <Progress percent={progressPercent ?? 0} />
            </div>
          ) : null}

          <div className="cleanup-overview">
            <Text type="secondary">平台</Text>
            <Text>{platformLabel(deps?.platform)}</Text>
            <Text type="secondary">目录</Text>
            <Text code>{deps?.whisperRoot ?? '—'}</Text>
            <Text type="secondary">
              总体状态：{deps ? (deps.ready ? '已就绪' : '未就绪') : '检测中…'}
            </Text>
          </div>

          {deps?.items.map((item) => (
            <div key={item.key} className="cleanup-overview">
              <Flexbox
                gap={8}
                horizontal
                style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
              >
                <Flexbox gap={8} horizontal style={{ alignItems: 'center' }}>
                  <Cable size={16} />
                  <Text weight={600}>{item.label}</Text>
                  <Tag color={item.ready ? 'success' : 'warning'}>
                    {item.ready ? '已就绪' : '缺失'}
                  </Tag>
                </Flexbox>
                <Flexbox gap={8} horizontal>
                  {item.canDelete ? (
                    <Button
                      danger
                      disabled={depsBusy}
                      icon={Trash2}
                      loading={busyKey === `remove:${item.key}`}
                      size="small"
                      type="default"
                      onClick={() => {
                        void runRemove(item.key, item.label)
                      }}
                    >
                      删除
                    </Button>
                  ) : null}
                  {item.canInstall ? (
                    <Button
                      disabled={depsBusy && busyKey !== item.key}
                      icon={Download}
                      loading={busyKey === item.key}
                      size="small"
                      type={item.ready ? 'default' : 'primary'}
                      onClick={() => {
                        void runInstall(item.key, item.ready)
                      }}
                    >
                      {item.ready ? '重新下载' : '下载'}
                    </Button>
                  ) : null}
                </Flexbox>
              </Flexbox>
              <Text type="secondary">{item.detail}</Text>
              {item.path ? <Text code>{item.path}</Text> : null}
              <Text type="secondary">大小 {formatBytes(item.bytes)}</Text>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
