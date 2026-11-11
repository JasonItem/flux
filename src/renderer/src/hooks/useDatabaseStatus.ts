import { useEffect, useState } from 'react'

import type { DatabaseStatus } from '../../../shared/api'

interface DatabaseStatusState {
  status: DatabaseStatus | null
  error: string | null
}

export function useDatabaseStatus(): DatabaseStatusState {
  const [status, setStatus] = useState<DatabaseStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    if (!window.studio) {
      setError('预加载脚本未注入')
      return
    }

    window.studio
      .getDatabaseStatus()
      .then((value) => {
        if (active) setStatus(value)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : '无法读取数据库状态')
      })

    return () => {
      active = false
    }
  }, [])

  return { status, error }
}
