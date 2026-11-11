import { Empty } from '@lobehub/ui'

import type { MainNavItem } from '../shell/nav'

export function PlaceholderPage({ item }: { item: MainNavItem }) {
  return (
    <div className="page">
      <div className="page-empty">
        <Empty
          description={item.emptyDescription}
          icon={item.icon}
          title={item.emptyTitle}
          type="page"
        />
      </div>
    </div>
  )
}
