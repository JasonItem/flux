import { Button, Empty, Flexbox, Input, Tag, Text, TextArea, toast } from '@lobehub/ui'
import { Section } from '@lobehub/ui/dashboard'
import { ArrowLeft, Copy, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { WorkshopScriptDetail, WorkshopScriptSegment } from '../../../shared/workshop'
import { buildFullScriptText } from '../../../shared/workshop'
import { navigate, researchVideoHref } from '../routes'
import { getStudio } from '../studioApi'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.max(0, Math.round(sec % 60))
  return `${String(m)}:${String(s).padStart(2, '0')}`
}

export function WorkshopScriptPage({ scriptId }: { scriptId: string }) {
  const [detail, setDetail] = useState<WorkshopScriptDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveHint, setSaveHint] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [activeIndex, setActiveIndex] = useState(0)
  const [replicating, setReplicating] = useState(false)
  const saveTimer = useRef<number | null>(null)
  const savedHintTimer = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await getStudio().workshop.getScript(scriptId)
      setDetail(next)
      setActiveIndex(0)
    } catch (error) {
      toast.error({ title: '加载脚本失败', description: errorMessage(error) })
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [scriptId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const off = getStudio().workshop.onProgress((event) => {
      if (event.scriptId !== scriptId) return
      if (event.phase === 'ready' || event.phase === 'error') {
        void load()
        setReplicating(false)
        if (event.phase === 'ready') toast.success({ title: '脚本已更新' })
        if (event.phase === 'error') toast.error({ title: '复刻失败', description: event.message })
      }
    })
    return off
  }, [scriptId, load])

  const persist = useCallback(async (next: WorkshopScriptDetail) => {
    setSaveHint('saving')
    try {
      const saved = await getStudio().workshop.updateScript({
        id: next.id,
        title: next.title,
        angle: next.angle,
        summary: next.summary,
        segments: next.segments,
        hooks: next.hooks,
        ctaOptions: next.ctaOptions,
        commentInsights: next.commentInsights,
      })
      setDetail(saved)
      setSaveHint('saved')
      if (savedHintTimer.current) window.clearTimeout(savedHintTimer.current)
      savedHintTimer.current = window.setTimeout(() => {
        setSaveHint('idle')
      }, 1600)
    } catch (error) {
      setSaveHint('idle')
      toast.error({ title: '保存失败', description: errorMessage(error) })
    }
  }, [])

  const scheduleSave = useCallback(
    (next: WorkshopScriptDetail) => {
      setDetail(next)
      setSaveHint('saving')
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void persist(next)
      }, 500)
    },
    [persist],
  )

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      if (savedHintTimer.current) window.clearTimeout(savedHintTimer.current)
    }
  }, [])

  const active = detail?.segments[activeIndex] ?? null

  const previewText = useMemo(() => {
    if (!detail) return ''
    return detail.fullScriptText || buildFullScriptText(detail.segments)
  }, [detail])

  const updateSegment = (patch: Partial<WorkshopScriptSegment>) => {
    if (!detail || !active) return
    const segments = detail.segments.map((seg, index) =>
      index === activeIndex ? { ...seg, ...patch } : seg,
    )
    scheduleSave({
      ...detail,
      segments,
      fullScriptText: buildFullScriptText(segments),
    })
  }

  const copyAll = async () => {
    if (!previewText.trim()) {
      toast.error({ title: '暂无可复制文案' })
      return
    }
    try {
      await navigator.clipboard.writeText(previewText)
      toast.success({ title: '已复制全部口播' })
    } catch {
      toast.error({ title: '复制失败' })
    }
  }

  const regenerate = async () => {
    if (!detail?.sourceResearchVideoId) {
      toast.error({ title: '无来源样本，无法重新生成' })
      return
    }
    setReplicating(true)
    try {
      await getStudio().workshop.enqueueReplicate(detail.sourceResearchVideoId, { force: true })
      toast.success({ title: '已加入重新生成', description: '完成后会自动刷新本页' })
    } catch (error) {
      setReplicating(false)
      toast.error({ title: '入队失败', description: errorMessage(error) })
    }
  }

  if (loading || !detail) {
    return (
      <div className="page">
        <div className="page-toolbar">
          <Button icon={ArrowLeft} type="text" onClick={() => navigate('/workshop')}>
            返回创作工坊
          </Button>
        </div>
        <div className="page-empty">
          {loading ? (
            <Text type="secondary">正在打开脚本…</Text>
          ) : (
            <Empty
              description="记录可能已被删除。"
              title="找不到该脚本"
              action={
                <Button type="primary" onClick={() => navigate('/workshop')}>
                  返回列表
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
      <div className="page-toolbar page-toolbar--spread">
        <Button icon={ArrowLeft} type="text" onClick={() => navigate('/workshop')}>
          返回创作工坊
        </Button>
        <Flexbox gap={8} horizontal wrap="wrap" style={{ alignItems: 'center' }}>
          {saveHint === 'saving' ? (
            <Text type="secondary">保存中…</Text>
          ) : saveHint === 'saved' ? (
            <Text type="secondary">保存成功</Text>
          ) : null}
          <Button icon={Copy} type="text" onClick={() => void copyAll()}>
            复制全部口播
          </Button>
          {detail.sourceResearchVideoId ? (
            <Button
              icon={RefreshCw}
              loading={replicating || detail.status === 'generating'}
              type="text"
              onClick={() => {
                void regenerate()
              }}
            >
              重新生成
            </Button>
          ) : null}
        </Flexbox>
      </div>

      <div className="page-stack">
        <Section title="脚本信息">
          <Flexbox gap={12}>
            <Input
              placeholder="脚本标题"
              value={detail.title}
              onChange={(event) => {
                scheduleSave({ ...detail, title: event.target.value })
              }}
            />
            <Input
              placeholder="切入角"
              value={detail.angle}
              onChange={(event) => {
                scheduleSave({ ...detail, angle: event.target.value })
              }}
            />
            <TextArea
              placeholder="整片策略摘要"
              rows={2}
              value={detail.summary}
              onChange={(event) => {
                scheduleSave({ ...detail, summary: event.target.value })
              }}
            />
            <Flexbox gap={8} horizontal wrap="wrap" style={{ alignItems: 'center' }}>
              <Tag>{detail.videoType}</Tag>
              <Tag>
                {detail.status === 'ready'
                  ? '已生成'
                  : detail.status === 'generating'
                    ? '生成中'
                    : detail.status === 'error'
                      ? '失败'
                      : '草稿'}
              </Tag>
              <Text type="secondary">约 {formatTime(detail.durationHintSec)}</Text>
              {detail.sourceResearchVideoId ? (
                <Button
                  size="small"
                  type="text"
                  onClick={() => {
                    navigate(researchVideoHref(detail.sourceResearchVideoId!))
                  }}
                >
                  查看来源拆解
                </Button>
              ) : null}
            </Flexbox>
            {detail.error ? <Text type="secondary">错误：{detail.error}</Text> : null}
          </Flexbox>
        </Section>

        <Section
          desc="点选段落编辑口播正文；思路仿写可改，保存后即可复制去拍。"
          title="分段口播"
        >
          {detail.segments.length === 0 ? (
            <Text type="secondary">暂无段落。可点「重新生成」。 </Text>
          ) : (
            <div className="workshop-editor">
              <div className="workshop-editor__rail">
                {detail.segments.map((seg, index) => (
                  <button
                    key={`${String(seg.order)}-${seg.title}`}
                    className={
                      index === activeIndex
                        ? 'workshop-editor__clip is-active'
                        : 'workshop-editor__clip'
                    }
                    type="button"
                    onClick={() => {
                      setActiveIndex(index)
                    }}
                  >
                    <span className="workshop-editor__clip-title">{seg.title}</span>
                    <span className="workshop-editor__clip-meta">
                      {seg.purpose} · 约 {String(seg.beatSec)}s
                    </span>
                  </button>
                ))}
              </div>

              <div className="workshop-editor__panel">
                {active ? (
                  <Flexbox gap={12}>
                    <Flexbox gap={8} horizontal wrap="wrap" style={{ alignItems: 'center' }}>
                      <Text weight={600} fontSize={16}>
                        {active.title}
                      </Text>
                      <Tag>{active.purpose}</Tag>
                      <Text type="secondary">建议 {String(active.beatSec)} 秒</Text>
                    </Flexbox>

                    <div className="research-structure-block">
                      <Text type="secondary">口播正文（可编辑）</Text>
                      <TextArea
                        rows={8}
                        value={active.spokenText}
                        onChange={(event) => {
                          updateSegment({ spokenText: event.target.value })
                        }}
                      />
                    </div>

                    <div className="research-structure-block">
                      <Text type="secondary">为何这样写</Text>
                      <TextArea
                        rows={3}
                        value={active.why}
                        onChange={(event) => {
                          updateSegment({ why: event.target.value })
                        }}
                      />
                    </div>

                    <div className="research-structure-block">
                      <Text type="secondary">剪辑提示</Text>
                      <TextArea
                        rows={2}
                        value={active.editHint}
                        onChange={(event) => {
                          updateSegment({ editHint: event.target.value })
                        }}
                      />
                    </div>

                    {active.sourceKeyLines.length > 0 ? (
                      <div className="research-structure-block">
                        <Text type="secondary">原片参考（只读对照）</Text>
                        {active.sourceKeyLines.map((line) => (
                          <Text key={line} type="secondary">
                            「{line}」
                          </Text>
                        ))}
                      </div>
                    ) : null}
                  </Flexbox>
                ) : null}
              </div>
            </div>
          )}
        </Section>

        <Section title="全文预览">
          <pre className="workshop-preview">{previewText || '暂无正文'}</pre>
        </Section>

        {(detail.hooks.length > 0 ||
          detail.ctaOptions.length > 0 ||
          detail.commentInsights.length > 0) && (
          <Section title="备选与洞察">
            <Flexbox gap={14}>
              {detail.hooks.length > 0 ? (
                <div>
                  <Text weight={600}>开场备选</Text>
                  <ul className="track-evidence-list">
                    {detail.hooks.map((item) => (
                      <li key={item}>
                        <Text>{item}</Text>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {detail.ctaOptions.length > 0 ? (
                <div>
                  <Text weight={600}>结尾备选</Text>
                  <ul className="track-evidence-list">
                    {detail.ctaOptions.map((item) => (
                      <li key={item}>
                        <Text>{item}</Text>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {detail.commentInsights.length > 0 ? (
                <div>
                  <Text weight={600}>评论洞察</Text>
                  <ul className="track-evidence-list">
                    {detail.commentInsights.map((item) => (
                      <li key={item}>
                        <Text>{item}</Text>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Flexbox>
          </Section>
        )}
      </div>
    </div>
  )
}