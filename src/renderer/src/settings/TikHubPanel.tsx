import {
  Button,
  Flexbox,
  Input,
  InputNumber,
  InputPassword,
  Switch,
  Text,
  toast,
} from '@lobehub/ui'
import { Form, useForm } from '@lobehub/ui/form'
import { Surface } from '@lobehub/ui/dashboard'
import { KeyRound, PlugZap, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  TikHubSettingsChangedEvent,
  type TikHubSettings,
} from '../../../shared/tikhub'

function notifyTikHubSettingsChanged(): void {
  window.dispatchEvent(new Event(TikHubSettingsChangedEvent))
}

interface TikHubFormValues {
  endpoint: string
  apiToken: string
  timeoutSeconds: number | null
  enabled: boolean
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
}

export function TikHubPanel() {
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [settings, setSettings] = useState<TikHubSettings | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  const form = useForm<TikHubFormValues>({
    initialValues: {
      endpoint: 'https://api.tikhub.io',
      apiToken: '',
      timeoutSeconds: 30,
      enabled: false,
    },
    onSubmit: async (values) => {
      try {
        const next = await window.studio.tikhub.updateSettings({
          endpoint: values.endpoint,
          apiToken: values.apiToken,
          timeoutSeconds: values.timeoutSeconds ?? 30,
          enabled: values.enabled,
        })
        setSettings(next)
        form.setValue('apiToken', '')
        notifyTikHubSettingsChanged()
        toast.success({
          title: 'TikHub 配置已保存',
          description: '账号管理将使用这份配置拉取抖音资料。',
        })
      } catch (error) {
        toast.error({ title: '保存失败', description: errorMessage(error) })
      }
    },
  })

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const next = await window.studio.tikhub.getSettings()
        if (!active) return
        setSettings(next)
        form.reset({
          endpoint: next.endpoint,
          apiToken: '',
          timeoutSeconds: next.timeoutSeconds,
          enabled: next.enabled,
        })
      } catch (error) {
        toast.error({ title: '读取 TikHub 配置失败', description: errorMessage(error) })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [form])

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const values = form.getValues()
      // Persist current form first so the test uses latest values.
      await window.studio.tikhub.updateSettings({
        endpoint: values.endpoint,
        apiToken: values.apiToken,
        timeoutSeconds: values.timeoutSeconds ?? 30,
        enabled: values.enabled,
      })
      const result = await window.studio.tikhub.testConnection()
      setTestResult(result.message)
      if (result.ok) {
        toast.success({
          title: '连接成功',
          description:
            result.balance !== undefined
              ? `余额 ${String(result.balance)}，赠额 ${String(result.freeCredit ?? 0)}`
              : result.message,
        })
      } else {
        toast.error({ title: '连接失败', description: result.message })
      }
      const next = await window.studio.tikhub.getSettings()
      setSettings(next)
      form.setValue('apiToken', '')
      notifyTikHubSettingsChanged()
    } catch (error) {
      toast.error({ title: '连接测试失败', description: errorMessage(error) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="settings-body">
      <div className="page-stack">
        {loading ? (
          <Text type="secondary">正在读取配置…</Text>
        ) : (
          <Form
            footer={
              <Flexbox gap={8} horizontal>
                <Form.SubmitFooter
                  enableReset
                  texts={{
                    reset: '重置',
                    submit: '保存',
                    unSaved: '有未保存的更改',
                    unSavedWarning: '离开前请确认是否保存',
                  }}
                />
                <Button
                  icon={PlugZap}
                  loading={testing}
                  type="default"
                  onClick={() => {
                    void testConnection()
                  }}
                >
                  测试连接
                </Button>
              </Flexbox>
            }
            form={form}
            items={[
              {
                children: [
                  {
                    children: <Input placeholder="https://api.tikhub.io" />,
                    desc: '默认生产环境地址，一般无需修改。',
                    label: '接口地址',
                    name: 'endpoint',
                  },
                  {
                    children: (
                      <InputPassword
                        autoComplete="off"
                        placeholder={
                          settings?.hasApiToken ? '留空则保留原 Token' : 'Bearer Token'
                        }
                        visibilityToggleLabels={{ hide: '隐藏令牌', show: '显示令牌' }}
                      />
                    ),
                    desc: settings?.hasApiToken
                      ? `已保存：${settings.apiTokenMasked}`
                      : '请求头使用 Authorization: Bearer {token}',
                    label: 'API Token',
                    name: 'apiToken',
                  },
                ],
                icon: KeyRound,
                key: 'connection',
                title: '连接',
              },
              {
                children: [
                  {
                    children: <InputNumber max={120} min={1} step={1} suffix="秒" />,
                    label: '超时',
                    name: 'timeoutSeconds',
                  },
                  {
                    children: <Switch />,
                    desc: '关闭后，账号管理将无法请求 TikHub。',
                    label: '启用',
                    name: 'enabled',
                  },
                ],
                icon: Timer,
                key: 'request',
                title: '请求',
              },
            ]}
            layout="vertical"
          />
        )}

        {testResult ? (
          <Surface title="最近一次连通性结果">
            <Text>{testResult}</Text>
          </Surface>
        ) : null}
      </div>
    </div>
  )
}
