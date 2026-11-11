import {
  Button,
  Empty,
  Flexbox,
  Input,
  InputPassword,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Text,
  toast,
} from '@lobehub/ui'
import { Section } from '@lobehub/ui/dashboard'
import { FlaskConical, Plus, Star, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { LlmModel, LlmProvider, LlmRemoteModel } from '../../../shared/llm'
import { getLlmApi } from '../studioApi'
import { providerPresets } from './llmPresets'

interface ProviderFormState {
  name: string
  baseUrl: string
  apiKey: string
  enabled: boolean
}

interface ModelFormState {
  providerId: string
  name: string
  modelId: string
  enabled: boolean
  isDefault: boolean
}

const emptyProviderForm = (): ProviderFormState => ({
  name: '',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  enabled: true,
})

const emptyModelForm = (providerId = ''): ModelFormState => ({
  providerId,
  name: '',
  modelId: '',
  enabled: true,
  isDefault: false,
})

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '操作失败'
  return (
    error.message
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '')
      .trim() || '操作失败'
  )
}

export function ModelPanel() {
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [models, setModels] = useState<LlmModel[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  const [providerOpen, setProviderOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<LlmProvider | null>(null)
  const [providerForm, setProviderForm] = useState<ProviderFormState>(emptyProviderForm)
  const [preset, setPreset] = useState<string>('openai')

  const [modelOpen, setModelOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<LlmModel | null>(null)
  const [modelForm, setModelForm] = useState<ModelFormState>(emptyModelForm())
  const [remoteModels, setRemoteModels] = useState<LlmRemoteModel[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [manualModelId, setManualModelId] = useState(false)

  const refresh = useCallback(async () => {
    const llm = getLlmApi()
    const [nextProviders, nextModels] = await Promise.all([
      llm.listProviders(),
      llm.listModels(),
    ])
    setProviders(nextProviders)
    setModels(nextModels)
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        await refresh()
      } catch (error) {
        toast.error({ title: '读取大模型配置失败', description: errorMessage(error) })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [refresh])

  const providerOptions = useMemo(
    () => providers.map((item) => ({ label: item.name, value: item.id })),
    [providers],
  )

  const openCreateProvider = () => {
    setEditingProvider(null)
    setPreset('openai')
    setProviderForm(emptyProviderForm())
    setProviderOpen(true)
  }

  const openEditProvider = (provider: LlmProvider) => {
    setEditingProvider(provider)
    setPreset('custom')
    setProviderForm({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: '',
      enabled: provider.enabled,
    })
    setProviderOpen(true)
  }

  const loadRemoteModels = useCallback(async (providerId: string, keepSelection = false) => {
    if (!providerId) {
      setRemoteModels([])
      setRemoteError(null)
      return
    }
    setRemoteLoading(true)
    setRemoteError(null)
    try {
      const list = await getLlmApi().listRemoteModels(providerId)
      setRemoteModels(list)
      if (!keepSelection) {
        setModelForm((current) => {
          if (current.providerId !== providerId) return current
          if (list.some((item) => item.id === current.modelId)) return current
          return { ...current, modelId: '', name: current.name }
        })
      }
    } catch (error) {
      setRemoteModels([])
      setRemoteError(errorMessage(error))
    } finally {
      setRemoteLoading(false)
    }
  }, [])

  const openCreateModel = () => {
    const providerId = providers[0]?.id ?? ''
    setEditingModel(null)
    setManualModelId(false)
    setRemoteModels([])
    setRemoteError(null)
    setModelForm(emptyModelForm(providerId))
    setModelOpen(true)
    if (providerId) void loadRemoteModels(providerId)
  }

  const openEditModel = (model: LlmModel) => {
    setEditingModel(model)
    setManualModelId(false)
    setRemoteModels([])
    setRemoteError(null)
    setModelForm({
      providerId: model.providerId,
      name: model.name,
      modelId: model.modelId,
      enabled: model.enabled,
      isDefault: model.isDefault,
    })
    setModelOpen(true)
    void loadRemoteModels(model.providerId, true)
  }

  const saveProvider = async () => {
    setSaving(true)
    try {
      const llm = getLlmApi()
      if (editingProvider) {
        await llm.updateProvider({
          id: editingProvider.id,
          name: providerForm.name,
          baseUrl: providerForm.baseUrl,
          apiKey: providerForm.apiKey,
          enabled: providerForm.enabled,
        })
        toast.success({ title: '渠道已更新' })
      } else {
        await llm.createProvider({
          name: providerForm.name,
          baseUrl: providerForm.baseUrl,
          apiKey: providerForm.apiKey,
          enabled: providerForm.enabled,
        })
        toast.success({ title: '渠道已创建' })
      }
      setProviderOpen(false)
      await refresh()
    } catch (error) {
      toast.error({ title: '保存渠道失败', description: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  const saveModel = async () => {
    setSaving(true)
    try {
      const llm = getLlmApi()
      if (editingModel) {
        await llm.updateModel({
          id: editingModel.id,
          providerId: modelForm.providerId,
          name: modelForm.name,
          modelId: modelForm.modelId,
          enabled: modelForm.enabled,
        })
        if (modelForm.isDefault && !editingModel.isDefault) {
          await llm.setDefaultModel(editingModel.id)
        }
        toast.success({ title: '模型已更新' })
      } else {
        await llm.createModel({
          providerId: modelForm.providerId,
          name: modelForm.name,
          modelId: modelForm.modelId,
          enabled: modelForm.enabled,
          isDefault: modelForm.isDefault,
        })
        toast.success({ title: '模型已创建' })
      }
      setModelOpen(false)
      await refresh()
    } catch (error) {
      toast.error({ title: '保存模型失败', description: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  const removeProvider = async (provider: LlmProvider) => {
    try {
      await getLlmApi().deleteProvider(provider.id)
      toast.success({ title: '渠道已删除', description: '关联模型已一并删除。' })
      await refresh()
    } catch (error) {
      toast.error({ title: '删除渠道失败', description: errorMessage(error) })
    }
  }

  const removeModel = async (model: LlmModel) => {
    try {
      await getLlmApi().deleteModel(model.id)
      toast.success({ title: '模型已删除' })
      await refresh()
    } catch (error) {
      toast.error({ title: '删除模型失败', description: errorMessage(error) })
    }
  }

  const makeDefault = async (model: LlmModel) => {
    try {
      await getLlmApi().setDefaultModel(model.id)
      toast.success({ title: '已设为默认模型' })
      await refresh()
    } catch (error) {
      toast.error({ title: '设置默认失败', description: errorMessage(error) })
    }
  }

  const testModel = async (model: LlmModel) => {
    setTestingId(model.id)
    try {
      const result = await getLlmApi().chat({
        modelId: model.id,
        messages: [{ role: 'user', content: '请只回复：ok' }],
        maxTokens: 32,
      })
      toast.success({
        title: '连通性测试成功',
        description: result.content.trim().slice(0, 120) || '上游已返回内容',
      })
    } catch (error) {
      toast.error({ title: '连通性测试失败', description: errorMessage(error) })
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="settings-body model-panel">
      <div className="page-stack">
        <Section
          desc="OpenAI 兼容渠道：填写 Base URL 与 API Key。密钥只保存在本机数据库。"
          extra={
            <Button icon={Plus} size="small" type="primary" onClick={openCreateProvider}>
              添加渠道
            </Button>
          }
          title="渠道"
        >
          {loading ? (
            <Text type="secondary">正在加载…</Text>
          ) : providers.length === 0 ? (
            <Empty
              description="先添加一个 OpenAI 兼容渠道，再绑定模型。"
              title="还没有渠道"
            />
          ) : (
            <Table<LlmProvider>
              columns={[
                { title: '名称', dataIndex: 'name', key: 'name' },
                {
                  title: '接口地址',
                  dataIndex: 'baseUrl',
                  key: 'baseUrl',
                  render: (value: string) => (
                    <Text code ellipsis={{ tooltip: true }}>
                      {value}
                    </Text>
                  ),
                },
                {
                  title: 'API Key',
                  key: 'apiKey',
                  render: (_: unknown, row: LlmProvider) =>
                    row.hasApiKey ? row.apiKeyMasked : <Text type="secondary">未填写</Text>,
                },
                {
                  title: '状态',
                  key: 'enabled',
                  width: 88,
                  render: (_: unknown, row: LlmProvider) =>
                    row.enabled ? <Tag>启用</Tag> : <Tag>停用</Tag>,
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 168,
                  render: (_: unknown, row: LlmProvider) => (
                    <Flexbox gap={8} horizontal>
                      <Button size="small" type="text" onClick={() => openEditProvider(row)}>
                        编辑
                      </Button>
                      <Button
                        danger
                        icon={Trash2}
                        size="small"
                        type="text"
                        onClick={() => {
                          void removeProvider(row)
                        }}
                      />
                    </Flexbox>
                  ),
                },
              ]}
              dataSource={providers}
              pagination={false}
              rowKey="id"
              variant="filled"
            />
          )}
        </Section>

        <Section
          desc="模型绑定到渠道。业务调用时用模型记录 ID，或省略以使用默认模型。"
          extra={
            <Button
              disabled={providers.length === 0}
              icon={Plus}
              size="small"
              type="primary"
              onClick={openCreateModel}
            >
              添加模型
            </Button>
          }
          title="模型"
        >
          {loading ? (
            <Text type="secondary">正在加载…</Text>
          ) : models.length === 0 ? (
            <Empty
              description={
                providers.length === 0
                  ? '请先添加渠道。'
                  : '添加后可设为默认，并做连通性测试。'
              }
              title="还没有模型"
            />
          ) : (
            <Table<LlmModel>
              columns={[
                {
                  title: '名称',
                  key: 'name',
                  render: (_: unknown, row: LlmModel) => (
                    <Flexbox align="center" gap={8} horizontal>
                      <span>{row.name}</span>
                      {row.isDefault ? <Tag>默认</Tag> : null}
                    </Flexbox>
                  ),
                },
                { title: '渠道', dataIndex: 'providerName', key: 'providerName' },
                {
                  title: '模型 ID',
                  dataIndex: 'modelId',
                  key: 'modelId',
                  render: (value: string) => (
                    <Text code ellipsis={{ tooltip: true }}>
                      {value}
                    </Text>
                  ),
                },
                {
                  title: '状态',
                  key: 'enabled',
                  width: 88,
                  render: (_: unknown, row: LlmModel) =>
                    row.enabled ? <Tag>启用</Tag> : <Tag>停用</Tag>,
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 280,
                  render: (_: unknown, row: LlmModel) => (
                    <Flexbox gap={4} horizontal wrap="wrap">
                      <Button
                        icon={FlaskConical}
                        loading={testingId === row.id}
                        size="small"
                        type="text"
                        onClick={() => {
                          void testModel(row)
                        }}
                      >
                        测试
                      </Button>
                      {!row.isDefault ? (
                        <Button
                          icon={Star}
                          size="small"
                          type="text"
                          onClick={() => {
                            void makeDefault(row)
                          }}
                        >
                          默认
                        </Button>
                      ) : null}
                      <Button size="small" type="text" onClick={() => openEditModel(row)}>
                        编辑
                      </Button>
                      <Button
                        danger
                        icon={Trash2}
                        size="small"
                        type="text"
                        onClick={() => {
                          void removeModel(row)
                        }}
                      />
                    </Flexbox>
                  ),
                },
              ]}
              dataSource={models}
              pagination={false}
              rowKey="id"
              variant="filled"
            />
          )}
        </Section>
      </div>

      <Modal
        confirmLoading={saving}
        destroyOnHidden
        okText="保存"
        open={providerOpen}
        title={editingProvider ? '编辑渠道' : '添加渠道'}
        width={520}
        onCancel={() => setProviderOpen(false)}
        onOk={() => {
          void saveProvider()
        }}
      >
        <div className="modal-form">
          {!editingProvider ? (
            <label className="modal-field">
              <span>预设</span>
              <Select
                options={providerPresets.map((item) => ({
                  label: item.label,
                  value: item.value,
                }))}
                placeholder="搜索或选择渠道预设"
                showSearch
                value={preset}
                onChange={(value) => {
                  const next = String(value)
                  setPreset(next)
                  const found = providerPresets.find((item) => item.value === next)
                  if (!found) return
                  if (found.value === 'custom') {
                    setProviderForm((current) => ({ ...current, baseUrl: '' }))
                    return
                  }
                  setProviderForm((current) => ({
                    ...current,
                    name: found.label,
                    baseUrl: found.baseUrl,
                  }))
                }}
              />
            </label>
          ) : null}
          <label className="modal-field">
            <span>名称</span>
            <Input
              placeholder="例如 DeepSeek"
              value={providerForm.name}
              onChange={(event) => {
                setProviderForm((current) => ({ ...current, name: event.target.value }))
              }}
            />
          </label>
          <label className="modal-field">
            <span>接口地址</span>
            <Input
              placeholder="https://api.openai.com/v1"
              value={providerForm.baseUrl}
              onChange={(event) => {
                setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))
              }}
            />
            {providerPresets.find((item) => item.value === preset)?.suggestedModelId ? (
              <Text type="secondary">
                常用模型 ID：
                {providerPresets.find((item) => item.value === preset)?.suggestedModelId}
              </Text>
            ) : null}
          </label>
          <label className="modal-field">
            <span>API Key</span>
            <InputPassword
              autoComplete="off"
              placeholder={
                editingProvider?.hasApiKey ? '留空则保留原密钥' : 'sk-...'
              }
              visibilityToggleLabels={{ hide: '隐藏密钥', show: '显示密钥' }}
              value={providerForm.apiKey}
              onChange={(event) => {
                setProviderForm((current) => ({ ...current, apiKey: event.target.value }))
              }}
            />
          </label>
          <label className="modal-field modal-field-inline">
            <span>启用</span>
            <Switch
              checked={providerForm.enabled}
              onChange={(checked) => {
                setProviderForm((current) => ({ ...current, enabled: checked }))
              }}
            />
          </label>
        </div>
      </Modal>

      <Modal
        confirmLoading={saving}
        destroyOnHidden
        okText="保存"
        open={modelOpen}
        title={editingModel ? '编辑模型' : '添加模型'}
        width={520}
        onCancel={() => setModelOpen(false)}
        onOk={() => {
          void saveModel()
        }}
      >
        <div className="modal-form">
          <label className="modal-field">
            <span>渠道</span>
            <Select
              options={providerOptions}
              placeholder="选择渠道"
              value={modelForm.providerId || undefined}
              onChange={(value) => {
                const providerId = String(value)
                setManualModelId(false)
                setModelForm((current) => ({
                  ...current,
                  providerId,
                  modelId: '',
                  name: '',
                }))
                void loadRemoteModels(providerId)
              }}
            />
          </label>
          <label className="modal-field">
            <span>模型</span>
            {manualModelId ? (
              <Input
                placeholder="手动填写模型 ID，例如 deepseek-chat"
                value={modelForm.modelId}
                onChange={(event) => {
                  const modelId = event.target.value
                  setModelForm((current) => ({
                    ...current,
                    modelId,
                    name: current.name || modelId,
                  }))
                }}
              />
            ) : (
              <Select
                disabled={!modelForm.providerId || remoteLoading}
                loading={remoteLoading}
                options={remoteModels.map((item) => ({
                  label: item.ownedBy ? `${item.id}（${item.ownedBy}）` : item.id,
                  value: item.id,
                }))}
                placeholder={
                  remoteLoading
                    ? '正在获取模型列表…'
                    : remoteError
                      ? '获取失败，可改手动填写'
                      : '从渠道拉取后单选'
                }
                showSearch
                value={modelForm.modelId || undefined}
                onChange={(value) => {
                  const modelId = String(value)
                  setModelForm((current) => ({
                    ...current,
                    modelId,
                    name: current.name.trim() ? current.name : modelId,
                  }))
                }}
              />
            )}
            <Flexbox gap={8} horizontal style={{ marginTop: 6 }}>
              <Button
                disabled={!modelForm.providerId || remoteLoading}
                size="small"
                type="text"
                onClick={() => {
                  if (modelForm.providerId) void loadRemoteModels(modelForm.providerId, true)
                }}
              >
                重新获取
              </Button>
              <Button
                size="small"
                type="text"
                onClick={() => {
                  setManualModelId((current) => !current)
                }}
              >
                {manualModelId ? '改用列表选择' : '手动填写 ID'}
              </Button>
            </Flexbox>
            {remoteError && !manualModelId ? (
              <Text type="secondary">拉取失败：{remoteError}</Text>
            ) : null}
          </label>
          <label className="modal-field">
            <span>展示名</span>
            <Input
              placeholder="可改成更易读的名字，默认用模型 ID"
              value={modelForm.name}
              onChange={(event) => {
                setModelForm((current) => ({ ...current, name: event.target.value }))
              }}
            />
          </label>
          <label className="modal-field modal-field-inline">
            <span>启用</span>
            <Switch
              checked={modelForm.enabled}
              onChange={(checked) => {
                setModelForm((current) => ({ ...current, enabled: checked }))
              }}
            />
          </label>
          <label className="modal-field modal-field-inline">
            <span>设为默认</span>
            <Switch
              checked={modelForm.isDefault}
              onChange={(checked) => {
                setModelForm((current) => ({ ...current, isDefault: checked }))
              }}
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}
