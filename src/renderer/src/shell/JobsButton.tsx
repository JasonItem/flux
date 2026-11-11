import { ActionIcon, Button, Flexbox, Modal, Tag, Text, toast } from '@lobehub/ui'
import { CheckCircle2, ListTodo, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { JobPhase, JobStatus, StudioJob } from '../../../shared/jobs'
import { RingProgress } from '../components/RingProgress'
import { navigate, type AppPath } from '../routes'

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
      return '成功'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    default:
      return status
  }
}

const toastedJobIds = new Set<string>()

export function JobsButton() {
  const [open, setOpen] = useState(false)
  const [jobs, setJobs] = useState<StudioJob[]>([])

  const refresh = useCallback(async () => {
    try {
      setJobs(await window.studio.jobs.list())
    } catch {
      // ignore until services ready
    }
  }, [])

  useEffect(() => {
    void refresh()
    const off = window.studio.jobs.onChanged((event) => {
      setJobs(event.jobs)
      for (const item of event.justFinished) {
        const toastKey = `${item.id}:${item.status}`
        if (toastedJobIds.has(toastKey)) continue
        toastedJobIds.add(toastKey)
        const job = event.jobs.find((row) => row.id === item.id)
        if (!job) continue
        if (item.status === 'succeeded') {
          toast.success({
            title: '任务完成',
            description: `${job.title} · 侧栏任务中心可点「查看」跳转`,
          })
        } else {
          toast.error({
            title: '任务失败',
            description: job.error || job.message || job.title,
          })
        }
      }
    })
    return off
  }, [refresh])

  const activeCount = useMemo(
    () => jobs.filter((job) => job.status === 'queued' || job.status === 'running').length,
    [jobs],
  )

  const cancel = async (id: string) => {
    try {
      await window.studio.jobs.cancel(id)
      await refresh()
    } catch (error) {
      toast.error({
        title: '取消失败',
        description: error instanceof Error ? error.message : '操作失败',
      })
    }
  }

  const clearFinished = async () => {
    try {
      setJobs(await window.studio.jobs.clearFinished())
    } catch (error) {
      toast.error({
        title: '清理失败',
        description: error instanceof Error ? error.message : '操作失败',
      })
    }
  }

  return (
    <>
      <span className="jobs-trigger-wrap">
        <ActionIcon
          icon={ListTodo}
          size="small"
          title="后台任务"
          onClick={() => {
            void refresh()
            setOpen(true)
          }}
        />
        {activeCount > 0 ? <span className="jobs-badge">{activeCount > 9 ? '9+' : String(activeCount)}</span> : null}
      </span>

      <Modal
        footer={
          <Flexbox gap={8} horizontal style={{ justifyContent: 'flex-end' }}>
            <Button
              type="text"
              onClick={() => {
                void clearFinished()
              }}
            >
              清空已完成
            </Button>
            <Button type="primary" onClick={() => setOpen(false)}>
              关闭
            </Button>
          </Flexbox>
        }
        open={open}
        title="后台任务"
        width={520}
        onCancel={() => setOpen(false)}
      >
        {jobs.length === 0 ? (
          <Text type="secondary">暂无任务。样本拆解与依赖下载会显示在这里。</Text>
        ) : (
          <div className="jobs-list">
            {jobs.map((job) => (
              <div className="jobs-item" key={job.id}>
                <div className="jobs-item__icon" aria-hidden>
                  {job.status === 'running' || job.status === 'queued' ? (
                    <RingProgress percent={job.percent} size={40} stroke={4} />
                  ) : job.status === 'succeeded' ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    <XCircle size={18} />
                  )}
                </div>
                <Flexbox gap={4} style={{ minWidth: 0, flex: 1 }}>
                  <Flexbox gap={8} horizontal style={{ alignItems: 'center' }} wrap="wrap">
                    <Text weight={600}>{job.title}</Text>
                    <Tag>{statusLabel(job.status)}</Tag>
                    {(job.status === 'running' || job.status === 'queued') && (
                      <Tag>{phaseLabel(job.phase)}</Tag>
                    )}
                  </Flexbox>
                  <Text type="secondary">
                    {job.message}
                    {typeof job.percent === 'number' ? ` · ${String(Math.round(job.percent))}%` : ''}
                  </Text>
                  <Flexbox gap={8} horizontal wrap="wrap">
                    {job.href ? (
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => {
                          navigate(job.href as AppPath)
                          setOpen(false)
                        }}
                      >
                        查看
                      </Button>
                    ) : null}
                    {job.status === 'queued' ? (
                      <Button
                        size="small"
                        type="text"
                        onClick={() => {
                          void cancel(job.id)
                        }}
                      >
                        取消
                      </Button>
                    ) : null}
                  </Flexbox>
                </Flexbox>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  )
}
