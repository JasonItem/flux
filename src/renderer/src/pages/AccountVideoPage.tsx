import {
  Button,
  Empty,
  Flexbox,
  Spin,
  Tag,
  Text,
  toast,
} from '@lobehub/ui'
import { Section, Surface } from '@lobehub/ui/dashboard'
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { AccountVideoAnalysis, AccountVideoComment } from '../../../shared/accountAnalysis'
import { CommentThreadList } from '../components/CommentThreadList'
import { DouyinTitleLink } from '../components/DouyinTitleLink'
import { PortraitPanel } from '../components/PortraitCharts'
import { navigate } from '../routes'
import { getStudio } from '../studioApi'

function normalizeComments(
  list: AccountVideoComment[] | undefined,
  prefix = 'c',
): AccountVideoComment[] {
  return (list ?? []).map((item, index) => {
    const id = item.id || `${prefix}-${String(index)}`
    return {
      ...item,
      id,
      avatarUrl: item.avatarUrl ?? null,
      replies: normalizeComments(item.replies, id),
    }
  })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
}

export function AccountVideoPage({
  accountId,
  awemeId,
}: {
  accountId: string
  awemeId: string
}) {
  const [detail, setDetail] = useState<AccountVideoAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(
    async (force: boolean) => {
      if (force) setRefreshing(true)
      else setLoading(true)
      try {
        if (!force) {
          // 有完整评论缓存则直接展示；旧缓存缺评论时走 getVideoAnalysis 补拉
          const account = await getStudio().accountAnalysis.getAnalysis(accountId)
          const cached = account?.videoAnalyses?.[awemeId]
          if (cached && Array.isArray(cached.comments) && cached.comments.length > 0) {
            setDetail({ ...cached, comments: normalizeComments(cached.comments) })
            return
          }
        }
        const next = force
          ? await getStudio().accountAnalysis.refreshVideoAnalysis(accountId, awemeId)
          : await getStudio().accountAnalysis.getVideoAnalysis(accountId, awemeId)
        setDetail({ ...next, comments: normalizeComments(next.comments) })
        if (force) toast.success({ title: '已刷新单视频分析' })
      } catch (error) {
        toast.error({ title: '单视频分析失败', description: errorMessage(error) })
        if (!force) setDetail(null)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [accountId, awemeId],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  return (
    <div className="page">
      <div className="page-toolbar page-toolbar--spread">
        <Button
          icon={ArrowLeft}
          type="text"
          onClick={() => {
            navigate('/accounts')
          }}
        >
          返回账号分析
        </Button>
        <Button
          disabled={loading || !detail}
          icon={RefreshCw}
          loading={refreshing}
          type="text"
          onClick={() => {
            void load(true)
          }}
        >
          刷新
        </Button>
      </div>

      {loading || !detail ? (
        <div className="page-empty">
          {loading ? (
            <div className="research-loading">
              <Spin size="large" />
              <Text weight={600}>正在分析该视频</Text>
              <Text type="secondary">
                首次打开会拉取评论并推断画像，结果会缓存；再次进入直接读缓存，点刷新才重算。
              </Text>
            </div>
          ) : (
            <Empty
              description="请先在账号分析页完成账号级分析，再点作品「详情」。"
              title="找不到分析结果"
              action={
                <Button type="primary" onClick={() => navigate('/accounts')}>
                  返回账号分析
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <div className="page-stack">
          <Flexbox gap={12} horizontal style={{ alignItems: 'flex-start' }}>
            {detail.coverUrl ? (
              <img
                alt=""
                className="account-video-hero-cover"
                referrerPolicy="no-referrer"
                src={detail.coverUrl}
              />
            ) : (
              <div className="account-video-hero-cover account-video-hero-cover--empty" />
            )}
            <Flexbox gap={8} style={{ minWidth: 0, flex: 1 }}>
              <DouyinTitleLink
                awemeId={detail.awemeId}
                className="research-video-title-link--detail"
                profileUrl={detail.profileUrl}
                title={detail.title}
              />
              <Flexbox gap={8} horizontal wrap="wrap">
                <Tag>评论样本 {String(detail.sampleCommentCount)}</Tag>
                {detail.profileUrl ? (
                  <Button
                    icon={ExternalLink}
                    size="small"
                    type="text"
                    onClick={() => {
                      window.open(detail.profileUrl, '_blank', 'noreferrer')
                    }}
                  >
                    打开抖音
                  </Button>
                ) : null}
              </Flexbox>
              <Text type="secondary">{detail.portrait.note}</Text>
            </Flexbox>
          </Flexbox>

          <div className="account-portrait-pair">
            <PortraitPanel title="本视频推断观众画像" block={detail.portrait.audience} />
            <PortraitPanel title="本视频推断粉丝画像" block={detail.portrait.fans} />
          </div>

          <Surface title="评论主题">
            <ul className="account-analysis-list">
              {detail.commentThemes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Surface>

          <Section
            desc="抖音式评论区：子评默认收起，区域内滚动加载；可按质量/点赞/回复/回复率排序。"
            title="优质评论"
          >
            <CommentThreadList comments={normalizeComments(detail.comments)} />
          </Section>

          <Surface title="内容建议">
            <ul className="account-analysis-list">
              {detail.contentTips.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Surface>
        </div>
      )}
    </div>
  )
}
