import {
  Alert,
  Avatar,
  Button,
  Empty,
  Flexbox,
  Input,
  Modal,
  Tag,
  Text,
  toast,
} from '@lobehub/ui'
import { Surface } from '@lobehub/ui/dashboard'
import { Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type {
  DouyinAccount,
  DouyinAccountPreview,
  DouyinVideoItem,
  TikHubSettings,
} from '../../../shared/tikhub'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
}

function formatCount(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return String(value)
}

export function AccountPanel() {
  const [accounts, setAccounts] = useState<DouyinAccount[]>([])
  const [settings, setSettings] = useState<TikHubSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [input, setInput] = useState('')
  const [resolving, setResolving] = useState(false)
  const [binding, setBinding] = useState(false)
  const [preview, setPreview] = useState<DouyinAccountPreview | null>(null)
  const [detail, setDetail] = useState<DouyinAccount | null>(null)
  const [videos, setVideos] = useState<DouyinVideoItem[]>([])
  const [videosLoading, setVideosLoading] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [nextAccounts, nextSettings] = await Promise.all([
      window.studio.tikhub.listAccounts(),
      window.studio.tikhub.getSettings(),
    ])
    setAccounts(nextAccounts)
    setSettings(nextSettings)
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        await refresh()
      } catch (error) {
        toast.error({ title: '读取账号失败', description: errorMessage(error) })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [refresh])

  const openAdd = () => {
    setInput('')
    setPreview(null)
    setAddOpen(true)
  }

  const resolvePreview = async () => {
    setResolving(true)
    try {
      const next = await window.studio.tikhub.resolveAccount(input)
      setPreview(next)
    } catch (error) {
      setPreview(null)
      toast.error({ title: '获取资料失败', description: errorMessage(error) })
    } finally {
      setResolving(false)
    }
  }

  const bindAccount = async () => {
    if (!preview) return
    setBinding(true)
    try {
      await window.studio.tikhub.bindAccount(preview)
      toast.success({ title: '已绑定抖音账号', description: preview.nickname })
      setAddOpen(false)
      setPreview(null)
      setInput('')
      await refresh()
    } catch (error) {
      toast.error({ title: '绑定失败', description: errorMessage(error) })
    } finally {
      setBinding(false)
    }
  }

  const refreshAccount = async (account: DouyinAccount) => {
    setRefreshingId(account.id)
    try {
      const next = await window.studio.tikhub.refreshAccount(account.id)
      toast.success({ title: '资料已刷新', description: next.nickname })
      await refresh()
      if (detail?.id === account.id) setDetail(next)
    } catch (error) {
      toast.error({ title: '刷新失败', description: errorMessage(error) })
    } finally {
      setRefreshingId(null)
    }
  }

  const removeAccount = async (account: DouyinAccount) => {
    try {
      await window.studio.tikhub.deleteAccount(account.id)
      toast.success({ title: '已删除账号' })
      if (detail?.id === account.id) {
        setDetail(null)
        setVideos([])
      }
      await refresh()
    } catch (error) {
      toast.error({ title: '删除失败', description: errorMessage(error) })
    }
  }

  const activateAccount = async (account: DouyinAccount) => {
    try {
      await window.studio.tikhub.setActiveAccount(account.id)
      toast.success({ title: '已设为当前工作账号', description: account.nickname })
      await refresh()
    } catch (error) {
      toast.error({ title: '切换失败', description: errorMessage(error) })
    }
  }

  const openDetail = async (account: DouyinAccount) => {
    setDetail(account)
    setVideos([])
    setVideosLoading(true)
    try {
      const page = await window.studio.tikhub.listAccountVideos(account.id, { count: 12 })
      setVideos(page.items)
    } catch (error) {
      toast.error({ title: '加载作品失败', description: errorMessage(error) })
    } finally {
      setVideosLoading(false)
    }
  }

  const tikhubReady = Boolean(settings?.enabled && settings.hasApiToken)

  return (
    <div className="settings-body">
      <div className="page-stack">
        {!tikhubReady ? (
          <Alert
            description="请先到「TikHub配置」填写 Token 并启用，然后才能添加抖音账号。"
            title="TikHub 尚未就绪"
            type="warning"
          />
        ) : null}

        <Flexbox gap={8} horizontal>
          <Button
            disabled={!tikhubReady}
            icon={Plus}
            type="primary"
            onClick={openAdd}
          >
            添加抖音账号
          </Button>
          <Button
            loading={loading}
            type="text"
            onClick={() => {
              void refresh()
            }}
          >
            刷新列表
          </Button>
        </Flexbox>

        {loading ? (
          <Text type="secondary">正在加载账号…</Text>
        ) : accounts.length === 0 ? (
          <Empty
            description="支持主页链接、分享链接或抖音号。本软件仅支持国内抖音。"
            title="还没有抖音账号"
          />
        ) : (
          <div className="account-grid">
            {accounts.map((account) => (
              <Surface
                key={account.id}
                extra={
                  account.isActive ? <Tag>当前</Tag> : undefined
                }
                title={account.nickname}
              >
                <Flexbox gap={12} horizontal style={{ alignItems: 'flex-start' }}>
                  <Avatar
                    avatar={account.avatarUrl ?? undefined}
                    size={56}
                    title={account.nickname}
                  />
                  <Flexbox gap={6} style={{ minWidth: 0, flex: 1 }}>
                    <Text type="secondary">
                      抖音号 {account.uniqueId || '未知'} · UID {account.uid || '未知'}
                    </Text>
                    <Text type="secondary" ellipsis={{ rows: 2, tooltip: true }}>
                      {account.signature || '暂无简介'}
                    </Text>
                    <Flexbox gap={12} horizontal wrap="wrap">
                      <Text>粉丝 {formatCount(account.followerCount)}</Text>
                      <Text>作品 {formatCount(account.awemeCount)}</Text>
                      <Text>获赞 {formatCount(account.totalFavorited)}</Text>
                    </Flexbox>
                    <Flexbox gap={4} horizontal wrap="wrap">
                      <Button size="small" type="text" onClick={() => void openDetail(account)}>
                        详情
                      </Button>
                      {!account.isActive ? (
                        <Button
                          icon={Star}
                          size="small"
                          type="text"
                          onClick={() => void activateAccount(account)}
                        >
                          设为当前
                        </Button>
                      ) : null}
                      <Button
                        icon={RefreshCw}
                        loading={refreshingId === account.id}
                        size="small"
                        type="text"
                        onClick={() => void refreshAccount(account)}
                      >
                        刷新
                      </Button>
                      <Button
                        danger
                        icon={Trash2}
                        size="small"
                        type="text"
                        onClick={() => void removeAccount(account)}
                      />
                    </Flexbox>
                  </Flexbox>
                </Flexbox>
              </Surface>
            ))}
          </div>
        )}
      </div>

      <Modal
        confirmLoading={binding}
        destroyOnHidden
        okButtonProps={{ disabled: !preview }}
        okText="确认绑定"
        open={addOpen}
        title="添加抖音账号"
        width={560}
        onCancel={() => setAddOpen(false)}
        onOk={() => {
          void bindAccount()
        }}
      >
        <div className="modal-form">
          <label className="modal-field">
            <span>主页链接 / 分享链接 / 抖音号</span>
            <Input
              placeholder="例如 https://www.douyin.com/user/... 或 抖音号"
              value={input}
              onChange={(event) => {
                setInput(event.target.value)
                setPreview(null)
              }}
            />
          </label>
          <Button
            loading={resolving}
            type="default"
            onClick={() => {
              void resolvePreview()
            }}
          >
            获取资料
          </Button>
          {preview ? (
            <Surface title="资料预览">
              <Flexbox gap={12} horizontal>
                <Avatar
                  avatar={preview.avatarUrl ?? undefined}
                  size={56}
                  title={preview.nickname}
                />
                <Flexbox gap={4}>
                  <Text weight={600}>{preview.nickname}</Text>
                  <Text type="secondary">抖音号 {preview.uniqueId || '未知'}</Text>
                  <Text type="secondary">
                    粉丝 {formatCount(preview.followerCount)} · 作品{' '}
                    {formatCount(preview.awemeCount)} · 获赞{' '}
                    {formatCount(preview.totalFavorited)}
                  </Text>
                </Flexbox>
              </Flexbox>
            </Surface>
          ) : null}
        </div>
      </Modal>

      <Modal
        destroyOnHidden
        footer={null}
        open={Boolean(detail)}
        title={detail ? `账号详情 · ${detail.nickname}` : '账号详情'}
        width={720}
        onCancel={() => {
          setDetail(null)
          setVideos([])
        }}
      >
        {detail ? (
          <div className="page-stack">
            <Flexbox gap={12} horizontal>
              <Avatar
                avatar={detail.avatarUrl ?? undefined}
                size={64}
                title={detail.nickname}
              />
              <Flexbox gap={4}>
                <Text weight={600}>{detail.nickname}</Text>
                <Text type="secondary">抖音号 {detail.uniqueId || '未知'}</Text>
                <Text type="secondary">sec_user_id {detail.secUserId}</Text>
                <Text type="secondary" ellipsis={{ rows: 3, tooltip: true }}>
                  {detail.signature || '暂无简介'}
                </Text>
              </Flexbox>
            </Flexbox>

            <Flexbox gap={16} horizontal wrap="wrap">
              <Text>粉丝 {formatCount(detail.followerCount)}</Text>
              <Text>关注 {formatCount(detail.followingCount)}</Text>
              <Text>作品 {formatCount(detail.awemeCount)}</Text>
              <Text>获赞 {formatCount(detail.totalFavorited)}</Text>
            </Flexbox>

            <Surface title="最近作品">
              {videosLoading ? (
                <Text type="secondary">正在加载作品…</Text>
              ) : videos.length === 0 ? (
                <Empty description="暂时没有拉到作品，可稍后重试。" title="暂无作品" />
              ) : (
                <div className="video-grid">
                  {videos.map((video) => (
                    <div className="video-card" key={video.awemeId}>
                      {video.coverUrl ? (
                        <img alt="" className="video-cover" src={video.coverUrl} />
                      ) : (
                        <div className="video-cover video-cover-empty" />
                      )}
                      <Text ellipsis={{ rows: 2, tooltip: true }}>
                        {video.description || '无标题'}
                      </Text>
                      <Text type="secondary">
                        赞 {formatCount(video.diggCount)} · 评{' '}
                        {formatCount(video.commentCount)}
                      </Text>
                    </div>
                  ))}
                </div>
              )}
            </Surface>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
