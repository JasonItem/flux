export const mainHrefs = [
  '/workbench',
  '/track',
  '/radar',
  '/research',
  '/workshop',
  '/accounts',
  '/jobs',
  '/settings',
] as const

export const settingsHrefs = [
  '/settings/accounts',
  '/settings/models',
  '/settings/tikhub',
  '/settings/network',
  '/settings/backup',
  '/settings/cleanup',
  '/settings/usage',
] as const

export type MainHref = (typeof mainHrefs)[number]
export type SettingsHref = (typeof settingsHrefs)[number]
export type ResearchVideoPath = `/research/video/${string}`
export type WorkshopScriptPath = `/workshop/${string}`
export type AccountVideoPath = `/accounts/video/${string}/${string}`
export type AppPath =
  | MainHref
  | SettingsHref
  | ResearchVideoPath
  | WorkshopScriptPath
  | AccountVideoPath

const mainSet = new Set<string>(mainHrefs)
const settingsSet = new Set<string>(settingsHrefs)

export function isResearchVideoPath(path: string): path is ResearchVideoPath {
  return /^\/research\/video\/[^/]+$/.test(path)
}

export function isWorkshopScriptPath(path: string): path is WorkshopScriptPath {
  return /^\/workshop\/[^/]+$/.test(path)
}

export function isAccountVideoPath(path: string): path is AccountVideoPath {
  return /^\/accounts\/video\/[^/]+\/[^/]+$/.test(path)
}

export function researchVideoHref(id: string): ResearchVideoPath {
  return `/research/video/${encodeURIComponent(id)}`
}

export function workshopScriptHref(id: string): WorkshopScriptPath {
  return `/workshop/${encodeURIComponent(id)}`
}

export function accountVideoHref(accountId: string, awemeId: string): AccountVideoPath {
  return `/accounts/video/${encodeURIComponent(accountId)}/${encodeURIComponent(awemeId)}`
}

export function parseResearchVideoId(path: AppPath): string | null {
  if (!isResearchVideoPath(path)) return null
  return decodeURIComponent(path.slice('/research/video/'.length))
}

export function parseWorkshopScriptId(path: AppPath): string | null {
  if (!isWorkshopScriptPath(path)) return null
  return decodeURIComponent(path.slice('/workshop/'.length))
}

export function parseAccountVideoParams(
  path: AppPath,
): { accountId: string; awemeId: string } | null {
  if (!isAccountVideoPath(path)) return null
  const parts = path.slice('/accounts/video/'.length).split('/')
  if (parts.length < 2) return null
  return {
    accountId: decodeURIComponent(parts[0]!),
    awemeId: decodeURIComponent(parts[1]!),
  }
}

export function normalizePath(hash: string): AppPath {
  const raw = hash.replace(/^#/, '')
  const path = raw.startsWith('/') ? raw : `/${raw}`

  if (path === '/topics' || path === '/lab') return '/research'
  if (path === '/' || path === '') return '/workbench'
  if (isResearchVideoPath(path)) return path
  if (isWorkshopScriptPath(path)) return path
  if (isAccountVideoPath(path)) return path
  if (path === '/settings') return '/settings/accounts'
  if (mainSet.has(path)) return path as MainHref
  if (settingsSet.has(path)) return path as SettingsHref
  return '/workbench'
}

export function isSettingsPath(path: AppPath): path is SettingsHref {
  return settingsSet.has(path)
}

export function navigate(href: AppPath): void {
  const next = `#${href}`
  if (window.location.hash === next) return
  window.location.hash = href
}
