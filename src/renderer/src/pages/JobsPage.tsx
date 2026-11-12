import { Button, Empty, Flexbox, Progress, Tag, Text, toast } from '@lobehub/ui'
import {
  CheckCircle2,
  CirclePlay,
  Clock3,
  ListTodo,
  Square,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { JobPhase, JobStatus, StudioJob } from '../../../shared/jobs'
import { navigate, type AppPath } from '../routes'
import { getStudio } from '../studioApi'

function phaseLabel(phase: JobPhase): string {
  switch (phase) {
    case 'queued':
      return '排队中'
    case 'downloading':
      return '下载视频'
    case 'deps':
      return '准备依赖'
    case 'transcribing':
      return '语音转写'
    case 'analyzing':
      return '大模型分析'
    case 'ready':
      return '完成'
    case 'error':
      return '失败'
    default:
      return '处理中'
  }
}

function statusLabel(status: JobStatus): string {
  switch (status) {
    case 'queued':
      return '排队'
    case 'running':
      return '进行中'
    case 'succeeded':
      return '已完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    default:
      return status
  }
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatDuration(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—'
  const sec = Math.round((end - start) / 1000)
  if (sec < 60) return `${String(sec)} 秒`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  if (min < 60) return rem > 0 ? `${String(min)} 分 ${String(rem)} 秒` : `${String(min)} 分钟`
  const hour = Math.floor(min / 60)
  const m = min % 60
  return `${String(hour)} 小时 ${String(m)} 分`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作失败'
}

export function JobsPage() {
  const [jobs, setJobs] = useState<StudioJob[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showAllCompleted, setShowAllCompleted] = useState(false)
  const [, setTick] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setJobs(await getStudio().jobs.list())
    } catch {
      // ignore until ready
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const off = getStudio().jobs.onChanged((event) => {
      setJobs(event.jobs)
      setLoading(false)
    })
    return off
  }, [refresh])

  useEffect(() => {
    const hasRunning = jobs.some((job) => job.status === 'running' || job.status === 'queued')
    if (!hasRunning) return
    const timer = window.setInterval(() => {
      setTick((n) => n + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [jobs])

  const running = useMemo(() => jobs.filter((job) => job.status === 'running'), [jobs])
  const queued = useMemo(() => jobs.filter((job) => job.status === 'queued'), [jobs])
  const completed = useMemo(
    () =>
      jobs
        .filter(
          (job) =>
            job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled',
        )
        .sort((a, b) => String(b.finishedAt ?? b.updatedAt).localeCompare(String(a.finishedAt ?? a.updatedAt))),
    [jobs],
  )
  const completedVisible = showAllCompleted ? completed : completed.slice(0, 9)

  const cancel = async (id: string) => {
    setBusyId(id)
    try {
      await getStudio().jobs.cancel(id)
      await refresh()
    } catch (error) {
      toast.error({ title: '取消失败', description: errorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  const clearFinished = async () => {
    setBusyId('clear')
    try {
      setJobs(await getStudio().jobs.clearFinished())
      toast.success({ title: '已清空已完成任务' })
    } catch (error) {
      toast.error({ title: '清理失败', description: errorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  const rerun = async (job: StudioJob) => {
    setBusyId(job.id)
    try {
      await getStudio().jobs.enqueue({
        kind: job.kind,
        title: job.title,
        href: job.href,
        dedupeKey: job.dedupeKey,
        payload: job.payload,
        force: true,
      })
      toast.success({ title: '已重新加入队列' })
      await refresh()
    } catch (error) {
      toast.error({ title: '重新运行失败', description: errorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  if (loading && jobs.length === 0) {
    return (
      <div className="page">
        <div className="page-empty">
          <Text type="secondary">正在读取任务队列…</Text>
        </div>
      </div>
    )
  }

  return (
    <div className="page jobs-page">
      <div className="jobs-page__header">
        <div>
          <Text as="h1" className="jobs-page__title" weight={700}>
            任务队列
          </Text>
          <Text type="secondary">管理你的任务，查看执行进度与结果</Text>
        </div>
        <Button
          disabled={completed.length === 0}
          icon={Trash2}
          loading={busyId === 'clear'}
          onClick={() => {
            void clearFinished()
          }}
        >
          清空已完成
        </Button>
      </div>

      {jobs.length === 0 ? (
        <div className="page-empty">
          <Empty
            description="样本拆解、下载与复刻脚本会显示在这里。"
            icon={ListTodo}
            title="暂无任务"
          />
        </div>
      ) : (
        <div className="jobs-page__stack">
          <section className="jobs-section">
            <div className="jobs-section__head">
              <Flexbox gap={8} horizontal style={{ alignItems: 'center' }}>
                <CirclePlay size={16} aria-hidden />
                <Text weight={600}>进行中 · {String(running.length)}</Text>
              </Flexbox>
            </div>
            {running.length === 0 ? (
              <Text type="secondary">当前没有正在执行的任务</Text>
            ) : (
              <div className="jobs-section__list">
                {running.map((job) => {
                  const percent = typeof job.percent === 'number' ? Math.round(job.percent) : null
                  return (
                    <div className="jobs-card" key={job.id}>
                      <div className="jobs-card__main">
                        <div className="jobs-card__thumb" aria-hidden>
                          <ListTodo size={18} />
                        </div>
                        <div className="jobs-card__body">
                          <Text weight={600}>{job.title}</Text>
                          <Text type="secondary">
                            已运行 {formatDuration(job.createdAt)} · {phaseLabel(job.phase)}
                            {job.message ? ` · ${job.message}` : ''}
                          </Text>
                          <div className="jobs-card__progress">
                            <Progress percent={percent ?? 0} showInfo={false} size="small" />
                            <Text type="secondary">{percent == null ? '…' : `${String(percent)}%`}</Text>
                          </div>
                          <details className="jobs-card__log">
                            <summary>执行日志</summary>
                            <Text as="div" type="secondary">
                              {job.message || phaseLabel(job.phase)}
                            </Text>
                          </details>
                        </div>
                        <Flexbox gap={4} horizontal>
                          {job.href ? (
                            <Button
                              size="small"
                              type="primary"
                              onClick={() => navigate(job.href as AppPath)}
                            >
                              查看
                            </Button>
                          ) : null}
                          <Button
                            danger
                            icon={Square}
                            loading={busyId === job.id}
                            size="small"
                            type="text"
                            onClick={() => {
                              void cancel(job.id)
                            }}
                          >
                            取消
                          </Button>
                        </Flexbox>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="jobs-section">
            <div className="jobs-section__head">
              <Flexbox gap={8} horizontal style={{ alignItems: 'center' }}>
                <Clock3 size={16} aria-hidden />
                <Text weight={600}>待执行 · {String(queued.length)}</Text>
              </Flexbox>
            </div>
            {queued.length === 0 ? (
              <Text type="secondary">队列空闲</Text>
            ) : (
              <div className="jobs-section__list">
                {queued.map((job) => (
                  <div className="jobs-row" key={job.id}>
                    <div className="jobs-card__thumb" aria-hidden>
                      <Clock3 size={16} />
                    </div>
                    <div className="jobs-row__body">
                      <Text weight={600}>{job.title}</Text>
                      <Text type="secondary">创建时间：{formatTime(job.createdAt)}</Text>
                    </div>
                    <Flexbox gap={4} horizontal>
                      {job.href ? (
                        <Button size="small" type="text" onClick={() => navigate(job.href as AppPath)}>
                          查看
                        </Button>
                      ) : null}
                      <Button
                        danger
                        icon={Square}
                        loading={busyId === job.id}
                        size="small"
                        type="text"
                        onClick={() => {
                          void cancel(job.id)
                        }}
                      >
                        取消
                      </Button>
                    </Flexbox>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="jobs-section">
            <div className="jobs-section__head">
              <Flexbox gap={8} horizontal style={{ alignItems: 'center' }}>
                <CheckCircle2 size={16} aria-hidden />
                <Text weight={600}>已完成 · {String(completed.length)}</Text>
              </Flexbox>
              {completed.length > 9 ? (
                <Button
                  size="small"
                  type="text"
                  onClick={() => {
                    setShowAllCompleted((v) => !v)
                  }}
                >
                  {showAllCompleted ? '收起' : '查看全部 >'}
                </Button>
              ) : null}
            </div>
            {completed.length === 0 ? (
              <Text type="secondary">还没有已完成的任务</Text>
            ) : (
              <div className="jobs-section__list">
                {completedVisible.map((job) => (
                  <div className="jobs-row" key={job.id}>
                    <div className="jobs-card__thumb" aria-hidden>
                      <CheckCircle2 size={16} />
                    </div>
                    <div className="jobs-row__body">
                      <Flexbox gap={8} horizontal style={{ alignItems: 'center' }} wrap="wrap">
                        <Text weight={600}>{job.title}</Text>
                        <Tag
                          color={
                            job.status === 'succeeded'
                              ? 'success'
                              : job.status === 'failed'
                                ? 'error'
                                : undefined
                          }
                        >
                          {statusLabel(job.status)}
                        </Tag>
                      </Flexbox>
                      <Text type="secondary">
                        运行时长 {formatDuration(job.createdAt, job.finishedAt)} · 完成时间{' '}
                        {formatTime(job.finishedAt ?? job.updatedAt)}
                      </Text>
                      {job.status === 'failed' && job.error ? (
                        <Text type="secondary">失败原因：{job.error}</Text>
                      ) : null}
                    </div>
                    <Flexbox gap={4} horizontal>
                      {job.href ? (
                        <Button size="small" type="text" onClick={() => navigate(job.href as AppPath)}>
                          查看
                        </Button>
                      ) : null}
                      <Button
                        icon={CirclePlay}
                        loading={busyId === job.id}
                        size="small"
                        type="primary"
                        onClick={() => {
                          void rerun(job)
                        }}
                      >
                        重新运行
                      </Button>
                    </Flexbox>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}