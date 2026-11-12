import { Button } from '@lobehub/ui'
import { PageHeader, PageTabs } from '@lobehub/ui/dashboard'
import { ArrowLeft } from 'lucide-react'

import { navigate, type SettingsHref } from '../routes'
import { settingsNav } from '../shell/nav'
import { AccountPanel } from './AccountPanel'
import { BackupPanel } from './BackupPanel'
import { CleanupPanel } from './CleanupPanel'
import { ModelPanel } from './ModelPanel'
import { TikHubPanel } from './TikHubPanel'
import { UsagePanel } from './UsagePanel'

const settingsKeys = new Set<string>(settingsNav.map((item) => item.href))

function isSettingsHref(key: string): key is SettingsHref {
  return settingsKeys.has(key)
}

function SettingsPanel({ href }: { href: SettingsHref }) {
  switch (href) {
    case '/settings/accounts':
      return <AccountPanel />
    case '/settings/models':
      return <ModelPanel />
    case '/settings/tikhub':
      return <TikHubPanel />
    case '/settings/backup':
      return <BackupPanel />
    case '/settings/cleanup':
      return <CleanupPanel />
    case '/settings/usage':
      return <UsagePanel />
    default: {
      const exhaustive: never = href
      return exhaustive
    }
  }
}

export function SettingsView({ path, onBack }: { path: SettingsHref; onBack: () => void }) {
  const current = settingsNav.find((item) => item.href === path) ?? settingsNav[0]
  if (!current) return null

  return (
    <div className="page settings-view">
      <PageHeader
        action={
          <Button icon={ArrowLeft} type="text" onClick={onBack}>
            返回
          </Button>
        }
        description={current.description}
        title="设置"
      />

      <PageTabs
        label="设置分区"
        tabs={settingsNav.map((item) => ({
          content: (
            <div className="settings-panel">
              <SettingsPanel href={item.href} />
            </div>
          ),
          label: item.label,
          value: item.href,
        }))}
        value={current.href}
        onChange={(key) => {
          if (isSettingsHref(key)) navigate(key)
        }}
      />
    </div>
  )
}
