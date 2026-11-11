import { ActionIcon, DropdownMenu } from '@lobehub/ui'
import { Settings } from 'lucide-react'

import { navigate } from '../routes'
import { settingsNav } from './nav'

interface SettingsButtonProps {
  active: boolean
}

export function SettingsButton({ active }: SettingsButtonProps) {
  return (
    <DropdownMenu
      items={settingsNav.map((item) => ({
        icon: item.icon,
        key: item.href,
        label: item.label,
        onClick: () => {
          navigate(item.href)
        },
      }))}
      placement="topLeft"
      triggerProps={{
        'aria-current': active ? 'page' : undefined,
        'aria-label': '设置',
        className: active ? 'settings-menu-trigger is-active' : 'settings-menu-trigger',
        title: '设置',
      }}
    >
      <ActionIcon active={active} icon={Settings} size="small" title="设置" />
    </DropdownMenu>
  )
}
