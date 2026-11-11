import { useEffect, useState } from 'react'

import { normalizePath, type AppPath } from '../routes'

export function useHashRoute(): AppPath {
  const [path, setPath] = useState<AppPath>(() => normalizePath(window.location.hash))

  useEffect(() => {
    const sync = (): void => {
      const next = normalizePath(window.location.hash)
      const current = window.location.hash.replace(/^#/, '')
      if (current !== next) {
        window.location.replace(`#${next}`)
        return
      }
      setPath(next)
    }

    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  return path
}
