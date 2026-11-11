import { ActionIcon, ConfigProvider, DropdownMenu, ToastHost, setLobeTheme } from '@lobehub/ui'
import type { AuthThemeMode } from '@lobehub/ui/dashboard'
import { Monitor, Moon, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'studio-theme'

interface ThemeModeValue {
  mode: AuthThemeMode
  setMode: (mode: AuthThemeMode) => void
}

const ThemeModeContext = createContext<ThemeModeValue | null>(null)

function readMode(): AuthThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored
  return 'auto'
}

function applyMode(mode: AuthThemeMode): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const appearance = mode === 'auto' ? (dark ? 'dark' : 'light') : mode

  // Keep Lobe's default black / white primary — do not set a hue preset.
  setLobeTheme({
    appearance,
    neutralColor: undefined,
    primaryColor: undefined,
  })
}

function modeIcon(mode: AuthThemeMode) {
  if (mode === 'light') return Sun
  if (mode === 'dark') return Moon
  return Monitor
}

function modeLabel(mode: AuthThemeMode): string {
  if (mode === 'light') return '浅色'
  if (mode === 'dark') return '深色'
  return '跟随系统'
}

export function ThemeRoot({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AuthThemeMode>(() => readMode())

  useEffect(() => {
    applyMode(mode)
    localStorage.setItem(STORAGE_KEY, mode)
    if (mode !== 'auto') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyMode('auto')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [mode])

  return (
    <ConfigProvider enableCustomFonts={false} locale="zh-CN" motion={motion}>
      <ToastHost />
      <ThemeModeContext value={{ mode, setMode }}>{children}</ThemeModeContext>
    </ConfigProvider>
  )
}

export function ThemeSwitch() {
  const value = useContext(ThemeModeContext)
  if (!value) return null

  return (
    <DropdownMenu
      items={[
        {
          icon: Sun,
          key: 'light',
          label: '浅色',
          onClick: () => {
            value.setMode('light')
          },
        },
        {
          icon: Moon,
          key: 'dark',
          label: '深色',
          onClick: () => {
            value.setMode('dark')
          },
        },
        {
          icon: Monitor,
          key: 'auto',
          label: '跟随系统',
          onClick: () => {
            value.setMode('auto')
          },
        },
      ]}
      placement="bottomRight"
      triggerProps={{
        'aria-label': '主题',
        className: 'theme-menu-trigger',
        title: `主题：${modeLabel(value.mode)}`,
      }}
    >
      <ActionIcon
        className="theme-menu-trigger"
        icon={modeIcon(value.mode)}
        size="small"
        title={`主题：${modeLabel(value.mode)}`}
      />
    </DropdownMenu>
  )
}
