import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { app, session } from 'electron'

import type {
  NetworkProxySettings,
  NetworkProxyUpdateInput,
  ProxyProtocol,
} from '../../shared/network'

const DEFAULT_PROXY: NetworkProxySettings = {
  enabled: false,
  protocol: 'http',
  host: '127.0.0.1',
  port: 7890,
}

function proxyFilePath(): string {
  return join(app.getPath('userData'), 'network-proxy.json')
}

function normalizeProtocol(value: unknown): ProxyProtocol {
  if (value === 'https' || value === 'socks5' || value === 'http') return value
  return 'http'
}

function normalizeSettings(raw: Partial<NetworkProxySettings> | null | undefined): NetworkProxySettings {
  const port = Number(raw?.port)
  return {
    enabled: Boolean(raw?.enabled),
    protocol: normalizeProtocol(raw?.protocol),
    host: String(raw?.host ?? DEFAULT_PROXY.host).trim() || DEFAULT_PROXY.host,
    port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : DEFAULT_PROXY.port,
  }
}

export function readProxySettings(): NetworkProxySettings {
  const file = proxyFilePath()
  if (!existsSync(file)) return { ...DEFAULT_PROXY }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<NetworkProxySettings>
    return normalizeSettings(parsed)
  } catch {
    return { ...DEFAULT_PROXY }
  }
}

export function writeProxySettings(input: NetworkProxyUpdateInput): NetworkProxySettings {
  const next = normalizeSettings(input)
  const file = proxyFilePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

function proxyRule(settings: NetworkProxySettings): string {
  return `${settings.protocol}://${settings.host}:${String(settings.port)}`
}

function clearEnvProxy(): void {
  delete process.env.HTTP_PROXY
  delete process.env.HTTPS_PROXY
  delete process.env.ALL_PROXY
  delete process.env.http_proxy
  delete process.env.https_proxy
  delete process.env.all_proxy
}

function applyEnvProxy(settings: NetworkProxySettings): void {
  if (!settings.enabled) {
    clearEnvProxy()
    return
  }
  const rule = proxyRule(settings)
  process.env.HTTP_PROXY = rule
  process.env.HTTPS_PROXY = rule
  process.env.ALL_PROXY = rule
  process.env.http_proxy = rule
  process.env.https_proxy = rule
  process.env.all_proxy = rule
}

/** Apply Chromium session proxy + env vars (helps net.fetch / some Node clients). */
export async function applyProxySettings(settings: NetworkProxySettings): Promise<void> {
  applyEnvProxy(settings)
  const ses = session.defaultSession
  if (!settings.enabled) {
    await ses.setProxy({ mode: 'direct' })
    return
  }
  await ses.setProxy({
    proxyRules: proxyRule(settings),
    proxyBypassRules: '<local>',
  })
}

export async function loadAndApplyProxySettings(): Promise<NetworkProxySettings> {
  const settings = readProxySettings()
  await applyProxySettings(settings)
  return settings
}

export async function updateAndApplyProxySettings(
  input: NetworkProxyUpdateInput,
): Promise<NetworkProxySettings> {
  const next = writeProxySettings(input)
  await applyProxySettings(next)
  return next
}