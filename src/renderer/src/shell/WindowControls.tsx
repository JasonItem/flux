import { ActionIcon } from '@lobehub/ui'
import { Minus, Square, SquareSquare, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let active = true
    const api = window.studio?.window
    if (!api) return
    void api.isMaximized().then((value) => {
      if (active) setMaximized(value)
    })
    const unsubscribe = api.onMaximizedChange((value) => {
      setMaximized(value)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <div className="window-controls">
      <ActionIcon
        aria-label="最小化"
        icon={Minus}
        size="small"
        title="最小化"
        onClick={() => {
          window.studio?.window.minimize()
        }}
      />
      <ActionIcon
        aria-label={maximized ? '还原' : '最大化'}
        icon={maximized ? SquareSquare : Square}
        size="small"
        title={maximized ? '还原' : '最大化'}
        onClick={() => {
          window.studio?.window.toggleMaximize()
        }}
      />
      <ActionIcon
        aria-label="关闭"
        danger
        icon={X}
        size="small"
        title="关闭"
        onClick={() => {
          window.studio?.window.close()
        }}
      />
    </div>
  )
}
