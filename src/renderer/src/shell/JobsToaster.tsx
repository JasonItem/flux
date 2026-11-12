import { toast } from '@lobehub/ui'
import { useEffect } from 'react'

const toastedJobIds = new Set<string>()

/** Global toasts for finished jobs; no UI chrome. */
export function JobsToaster() {
  useEffect(() => {
    const studio = window.studio
    if (!studio?.jobs?.onChanged) return
    const off = studio.jobs.onChanged((event) => {
      for (const item of event.justFinished) {
        const toastKey = `${item.id}:${item.status}`
        if (toastedJobIds.has(toastKey)) continue
        toastedJobIds.add(toastKey)
        const job = event.jobs.find((row) => row.id === item.id)
        if (!job) continue
        if (item.status === 'succeeded') {
          toast.success({
            title: '任务完成',
            description: `${job.title} · 可在「任务队列」查看结果`,
          })
        } else if (item.status === 'cancelled') {
          toast.info({
            title: '任务已取消',
            description: job.title,
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
  }, [])

  return null
}