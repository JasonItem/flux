export const NetworkChannels = {
  getProxy: 'network:get-proxy',
  updateProxy: 'network:update-proxy',
  getDepsStatus: 'network:get-deps-status',
  installDeps: 'network:install-deps',
  removeDep: 'network:remove-dep',
  depsProgress: 'network:deps-progress',
} as const

export type ProxyProtocol = 'http' | 'https' | 'socks5'

export type WhisperDepKey = 'engine' | 'model' | 'ffmpeg'

export interface NetworkProxySettings {
  enabled: boolean
  protocol: ProxyProtocol
  host: string
  port: number
}

export interface NetworkProxyUpdateInput {
  enabled: boolean
  protocol: ProxyProtocol
  host: string
  port: number
}

export interface NetworkDepsInstallInput {
  /** 不传则安装全部可下载依赖 */
  key?: WhisperDepKey
  /** 先删除再下载（重新下载） */
  force?: boolean
}

export interface WhisperDepItemStatus {
  key: WhisperDepKey
  label: string
  ready: boolean
  path: string | null
  bytes: number
  detail: string
  /** 位于用户数据目录，可安全删除 */
  managed: boolean
  canDelete: boolean
  canInstall: boolean
}

export interface WhisperDepsStatus {
  ready: boolean
  items: WhisperDepItemStatus[]
  whisperRoot: string
  platform: 'win32' | 'darwin' | 'linux' | string
}

export interface NetworkDepsProgressEvent {
  message: string
  percent?: number
}

export interface NetworkApi {
  getProxy: () => Promise<NetworkProxySettings>
  updateProxy: (input: NetworkProxyUpdateInput) => Promise<NetworkProxySettings>
  getDepsStatus: () => Promise<WhisperDepsStatus>
  installDeps: (input?: NetworkDepsInstallInput) => Promise<WhisperDepsStatus>
  removeDep: (key: WhisperDepKey) => Promise<WhisperDepsStatus>
  onDepsProgress: (callback: (event: NetworkDepsProgressEvent) => void) => () => void
}

export const NetworkProxyChangedEvent = 'studio:network-proxy-changed'