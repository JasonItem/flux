import type { CSSProperties, MouseEvent, ReactNode } from 'react'

import { isAppMockMediaUrl } from '../mockMedia'

export function resolveDouyinVideoUrl(input: {
  profileUrl?: string | null
  awemeId?: string | null
}): string | null {
  const awemeId = input.awemeId?.trim()
  if (awemeId && !awemeId.startsWith('mock_')) {
    return `https://www.douyin.com/video/${awemeId}`
  }
  const profileUrl = input.profileUrl?.trim() || ''
  if (
    profileUrl &&
    /^https?:\/\//i.test(profileUrl) &&
    !isAppMockMediaUrl(profileUrl)
  ) {
    return profileUrl
  }
  return null
}

export function DouyinTitleLink({
  title,
  profileUrl,
  awemeId,
  className,
  style,
  children,
}: {
  title: string
  profileUrl?: string | null
  awemeId?: string | null
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  const href = resolveDouyinVideoUrl({ profileUrl, awemeId })
  if (!href) {
    return (
      <span className={className} style={style} title={title}>
        {children ?? title}
      </span>
    )
  }

  return (
    <a
      className={className ? `research-video-title-link ${className}` : 'research-video-title-link'}
      href={href}
      rel="noreferrer"
      style={style}
      target="_blank"
      title={title}
      onClick={(event: MouseEvent) => {
        event.stopPropagation()
      }}
    >
      {children ?? title}
    </a>
  )
}
