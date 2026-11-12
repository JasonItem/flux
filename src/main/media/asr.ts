import { randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { chmod } from 'node:fs/promises'
import { arch } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

import { net } from 'electron'
import extractZip from 'extract-zip'

import { audioFilePath, isUsableMediaFile, whisperRootDir } from './paths'

/** Official Windows zip; macOS prebuilds (whisper.cpp has no official mac CLI zips). */
const WHISPER_WIN_ZIP =
  'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip'
const WHISPER_MAC_ARM64_ZIP =
  'https://github.com/bizenlabs-old/whisper-cpp-macos-bin/releases/download/v1.8.2-2/whisper-cpp-v1.8.2-macos-arm64-metal.zip'
const WHISPER_MAC_X64_ZIP =
  'https://github.com/bizenlabs-old/whisper-cpp-macos-bin/releases/download/v1.8.2-2/whisper-cpp-v1.8.2-macos-x86_64-accelerate.zip'

/** GitHub 直连易被重置时的镜像前缀（国内常用） */
function githubReleaseMirrors(url: string): string[] {
  return [
    url,
    `https://ghfast.top/${url}`,
    `https://mirror.ghproxy.com/${url}`,
    `https://ghproxy.net/${url}`,
  ]
}

export interface TranscriptCue {
  startSec: number
  endSec: number
  text: string
}

export interface TranscriptResult {
  fullTranscript: string
  cues: TranscriptCue[]
}

const MODEL_NAME = 'ggml-small.bin'
/** 官方源 + 国内镜像；代理打不开 HF 时可走镜像 */
const MODEL_URLS = [
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin?download=true',
  'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin?download=true',
] as const
/** ggml-small.bin ≈ 488MB；过小说明下载到了错误页/半截文件 */
const MODEL_MIN_BYTES = 100_000_000
/** 完整模型约 488MB；有 Content-Length 时至少收齐 95% */
const MODEL_EXPECTED_BYTES = 480_000_000

async function clearMacQuarantine(target: string): Promise<void> {
  if (process.platform !== 'darwin') return
  try {
    await runCommand('xattr', ['-cr', target])
  } catch {
    // ignore — unsigned downloads may still run after chmod
  }
}

function isExecutableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * ffmpeg-static 在 asar 内 require 出来的路径仍带 `app.asar/`，
 * 真实二进制在 `app.asar.unpacked/`；直接 spawn asar 路径会报 ENOTDIR。
 */
function resolveUnpackedBinary(candidate: string): string {
  if (candidate.includes('app.asar.unpacked')) return candidate
  if (!candidate.includes('app.asar')) return candidate
  return candidate.replace('app.asar', 'app.asar.unpacked')
}

function ffmpegBinary(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegStatic = require('ffmpeg-static') as string | null
  if (!ffmpegStatic) {
    throw new Error('未找到 ffmpeg-static，请重新安装依赖')
  }
  const resolved = resolveUnpackedBinary(ffmpegStatic)
  if (!isExecutableFile(resolved)) {
    throw new Error(`未找到 ffmpeg 可执行文件：${resolved}`)
  }
  return resolved
}

function whisperCliName(): string {
  return process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
}

function whisperStableCliPath(): string {
  return join(whisperRootDir(), whisperCliName())
}

/**
 * whisper.cpp Windows zip 里的 main.exe / 根目录 whisper-cli.exe 常是弃用提示桩（约 20–30KB，exit 1）。
 * 真正的 CLI 在 Release/whisper-cli.exe（数百 KB+）。
 */
function isWhisperDeprecationStub(path: string): boolean {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return false
    const size = statSync(path).size
    if (size <= 0 || size >= 100_000) return false
    const fd = openSync(path, 'r')
    try {
      const buf = Buffer.alloc(Math.min(size, 4096))
      const n = readSync(fd, buf, 0, buf.length, 0)
      const text = buf.subarray(0, n).toString('utf8')
      return /deprecated/i.test(text) || /deprecation-warning/i.test(text)
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}

function hasWhisperRuntimeLibs(cliPath: string): boolean {
  if (process.platform !== 'win32') return true
  const dir = dirname(cliPath)
  // Windows zip 把 ggml/whisper DLL 与 CLI 放在同一目录（通常是 Release/）
  return existsSync(join(dir, 'whisper.dll')) || existsSync(join(dir, 'ggml.dll'))
}

function isUsableWhisperCli(path: string): boolean {
  return (
    isExecutableFile(path) &&
    !isWhisperDeprecationStub(path) &&
    hasWhisperRuntimeLibs(path)
  )
}

function purgeOrphanWindowsCliCopy(): void {
  if (process.platform !== 'win32') return
  const orphan = whisperStableCliPath()
  try {
    if (existsSync(orphan) && !hasWhisperRuntimeLibs(orphan)) {
      unlinkSync(orphan)
    }
  } catch {
    // ignore
  }
}

function whisperCliPath(): string {
  purgeOrphanWindowsCliCopy()
  const root = whisperRootDir()
  const name = whisperCliName()
  // Prefer Release/（含 DLL）；禁止使用根目录孤立拷贝
  const preferred = [
    join(root, 'Release', name),
    join(root, 'bin', name),
    join(root, name),
  ]
  for (const candidate of preferred) {
    if (isUsableWhisperCli(candidate)) return candidate
  }
  const nested = findFileRecursive(root, [
    name,
    process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli',
  ])
  if (nested && isUsableWhisperCli(nested)) return nested
  // 旧包可能只有 main；仍需排除弃用桩 / 缺 DLL
  const legacyName = process.platform === 'win32' ? 'main.exe' : 'main'
  const legacy =
    findFileRecursive(root, [legacyName]) || join(root, 'Release', legacyName)
  if (legacy && isUsableWhisperCli(legacy)) return legacy
  return join(root, 'Release', name)
}

function installStableWhisperCli(found: string): string {
  if (!isUsableWhisperCli(found)) return found
  purgeOrphanWindowsCliCopy()
  // Windows：绝不能把 CLI 单独拷到用户目录根（会缺 DLL → exit 3221225781）
  if (process.platform === 'win32') return found
  const stable = whisperStableCliPath()
  if (found === stable) return stable
  mkdirSync(dirname(stable), { recursive: true })
  try {
    if (existsSync(stable)) unlinkSync(stable)
    copyFileSync(found, stable)
  } catch {
    return found
  }
  return isUsableWhisperCli(stable) ? stable : found
}

function modelPath(): string {
  return join(whisperRootDir(), MODEL_NAME)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('已取消')
    err.name = 'AbortError'
    throw err
  }
}

function looksLikeGgmlModel(filePath: string): boolean {
  let fd: number | null = null
  try {
    fd = openSync(filePath, 'r')
    const buf = Buffer.alloc(4)
    const n = readSync(fd, buf, 0, 4, 0)
    if (n < 4) return false
    // whisper.cpp GGML_FILE_MAGIC 0x67676d6c on LE disk = 6c 6d 67 67 ("lmgg")
    if (buf[0] === 0x6c && buf[1] === 0x6d && buf[2] === 0x67 && buf[3] === 0x67) return true
    // ASCII / BE variants + GGUF
    const magic = buf.toString('ascii')
    return magic === 'ggml' || magic === 'ggmf' || magic === 'ggjt' || magic === 'GGUF'
  } catch {
    return false
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // ignore
      }
    }
  }
}

function isTransientNetworkError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'string'
        ? error
        : String(error)
  return /ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_TIMED_OUT|ERR_NETWORK_CHANGED|ERR_EMPTY_RESPONSE|ERR_SSL|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(
    text,
  )
}

function friendlyDownloadError(error: unknown, url: string): Error {
  if (error instanceof Error && error.name === 'AbortError') return error
  const raw = error instanceof Error ? error.message : String(error)
  if (/ERR_CONNECTION_RESET|ECONNRESET|connection reset/i.test(raw)) {
    return new Error(
      `下载连接被重置（${url}）。删除依赖后需重新下载，请到设置 → 网络与依赖启用代理（如 127.0.0.1:7890）后再下载或重试拆解`,
    )
  }
  if (isTransientNetworkError(error)) {
    return new Error(
      `网络不稳定导致下载失败：${raw}。请到设置 → 网络与依赖配置代理后，先点「下载缺失依赖」再拆解`,
    )
  }
  return error instanceof Error ? error : new Error(raw)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('已取消')
      err.name = 'AbortError'
      reject(err)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      const err = new Error('已取消')
      err.name = 'AbortError'
      reject(err)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function downloadFileOnce(
  url: string,
  dest: string,
  onProgress?: (percent?: number) => void,
  signal?: AbortSignal,
  options?: { minBytes?: number; requireGgml?: boolean },
): Promise<void> {
  throwIfAborted(signal)
  mkdirSync(dirname(dest), { recursive: true })
  let response: Response
  try {
    response = await net.fetch(url, { method: 'GET', redirect: 'follow', signal })
  } catch (error) {
    throw friendlyDownloadError(error, url)
  }
  if (!response.ok || !response.body) {
    throw new Error(
      `下载失败（HTTP ${String(response.status)}）。可在设置中配置代理后重试：${url}`,
    )
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('text/html')) {
    throw new Error(`下载到了网页而非文件（可能需代理）：${url}`)
  }
  const total = Number(response.headers.get('content-length') || 0)
  let received = 0
  const nodeStream = Readable.fromWeb(response.body as never)
  const onAbort = () => {
    nodeStream.destroy(new Error('已取消'))
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) onProgress?.(Math.min(99, Math.round((received / total) * 100)))
    else if (options?.minBytes && options.minBytes > 0) {
      onProgress?.(Math.min(99, Math.round((received / options.minBytes) * 100)))
    }
  })
  // Unique temp avoids concurrent downloads clobbering the same .part
  const temp = `${dest}.${randomUUID()}.part`
  try {
    await pipeline(nodeStream, createWriteStream(temp))
    throwIfAborted(signal)
    const size = existsSync(temp) ? statSync(temp).size : 0
    if (size <= 0) {
      throw new Error('下载结果为空，请检查网络或代理后重试')
    }
    if (total > 0 && size < Math.floor(total * 0.95)) {
      throw new Error(
        `下载不完整（${String(size)} / ${String(total)} 字节），请检查网络或代理后重试`,
      )
    }
    if (options?.minBytes && size < options.minBytes) {
      throw new Error(
        `下载不完整（仅 ${String(size)} 字节，至少需要 ${String(options.minBytes)}），请检查网络或代理后重试`,
      )
    }
    if (options?.requireGgml && !looksLikeGgmlModel(temp)) {
      throw new Error('下载文件不是有效的 Whisper 模型，请检查网络或代理后重试')
    }
    try {
      if (existsSync(dest)) unlinkSync(dest)
    } catch {
      // ignore
    }
    try {
      renameSync(temp, dest)
    } catch {
      copyFileSync(temp, dest)
      try {
        unlinkSync(temp)
      } catch {
        // ignore
      }
    }
    onProgress?.(100)
  } catch (error) {
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {
      // ignore
    }
    if (signal?.aborted) {
      const err = new Error('已取消')
      err.name = 'AbortError'
      throw err
    }
    throw friendlyDownloadError(error, url)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (percent?: number) => void,
  signal?: AbortSignal,
  options?: { minBytes?: number; requireGgml?: boolean },
): Promise<void> {
  const maxAttempts = 3
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(signal)
    try {
      await downloadFileOnce(url, dest, onProgress, signal, options)
      return
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      lastError = error
      if (!isTransientNetworkError(error) || attempt >= maxAttempts) break
      onProgress?.(0)
      await sleep(800 * attempt, signal)
    }
  }
  throw friendlyDownloadError(lastError, url)
}

async function downloadWithMirrors(
  urls: readonly string[],
  dest: string,
  onProgress?: (percent?: number) => void,
  signal?: AbortSignal,
  options?: { minBytes?: number; requireGgml?: boolean },
): Promise<void> {
  let lastError: unknown = null
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index]
    if (!url) continue
    throwIfAborted(signal)
    try {
      if (index > 0) onProgress?.(0)
      await downloadFile(url, dest, onProgress, signal, options)
      return
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      lastError = error
    }
  }
  const tip =
    '所有下载源均失败。请到设置 → 网络与依赖启用代理后，先「下载缺失依赖」，再重新拆解'
  if (lastError instanceof Error) {
    throw new Error(`${lastError.message}；${tip}`)
  }
  throw new Error(tip)
}

let whisperBinaryLock: Promise<string> | null = null
let whisperModelLock: Promise<string> | null = null

function findFileRecursive(dir: string, names: string[]): string | null {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isFile() && names.includes(entry.name)) return full
    if (entry.isDirectory()) {
      const nested = findFileRecursive(full, names)
      if (nested) return nested
    }
  }
  return null
}

function bundledWhisperCandidate(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    const name = whisperCliName()
    const roots = [
      join(process.resourcesPath || '', 'whisper', name),
      join(process.resourcesPath || '', name),
      join(app.getAppPath(), 'resources', 'whisper', name),
    ]
    for (const candidate of roots) {
      if (isUsableWhisperCli(candidate)) return candidate
    }
  } catch {
    // ignore
  }
  return null
}

function macWhisperZipUrl(): string {
  const cpu = arch()
  if (cpu === 'arm64') return WHISPER_MAC_ARM64_ZIP
  return WHISPER_MAC_X64_ZIP
}

function systemWhisperCandidates(): string[] {
  if (process.platform === 'win32') return []
  return [
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
    '/opt/homebrew/bin/whisper',
    '/usr/local/bin/whisper',
  ]
}

async function finalizeWhisperCli(found: string): Promise<string> {
  if (process.platform !== 'win32') {
    try {
      await chmod(found, 0o755)
    } catch {
      // ignore
    }
  }
  await clearMacQuarantine(dirname(found))
  await clearMacQuarantine(found)
  const stable = installStableWhisperCli(found)
  if (stable !== found && process.platform !== 'win32') {
    try {
      await chmod(stable, 0o755)
    } catch {
      // ignore
    }
    await clearMacQuarantine(stable)
  }
  if (!isUsableWhisperCli(stable)) throw new Error('Whisper 引擎安装失败')
  return stable
}

async function installWhisperBinary(
  onProgress?: (message: string, percent?: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal)
  const existing = whisperCliPath()
  if (isUsableWhisperCli(existing)) {
    return finalizeWhisperCli(existing)
  }

  const bundled = bundledWhisperCandidate()
  if (bundled && isUsableWhisperCli(bundled)) {
    return finalizeWhisperCli(bundled)
  }

  for (const candidate of systemWhisperCandidates()) {
    if (isUsableWhisperCli(candidate)) return candidate
  }

  // Prefer system-installed whisper-cli if present on PATH
  const which = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await runCommand(which, [whisperCliName().replace('.exe', '')], {
      signal,
    })
    const line = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean)
    if (line && isUsableWhisperCli(line)) return line
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    // continue to download
  }

  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    throw new Error(
      '未找到 whisper-cli。请安装 whisper.cpp（例如 brew install whisper-cpp），或将二进制放入 resources/whisper/。',
    )
  }

  onProgress?.('正在下载 Whisper 引擎…', 0)
  const root = whisperRootDir()
  const zipPath = join(root, 'whisper-bin.zip')
  const zipUrl = process.platform === 'darwin' ? macWhisperZipUrl() : WHISPER_WIN_ZIP
  // 已有 zip 时直接解压，避免进度满了又从头下
  if (!isUsableMediaFile(zipPath, 1024 * 1024)) {
    await downloadWithMirrors(
      githubReleaseMirrors(zipUrl),
      zipPath,
      (p) => onProgress?.('正在下载 Whisper 引擎…', p),
      signal,
      { minBytes: 1024 * 1024 },
    )
  } else {
    onProgress?.('正在解压 Whisper 引擎…', 100)
  }
  throwIfAborted(signal)
  onProgress?.('正在解压 Whisper 引擎…', 100)
  await extractZip(zipPath, { dir: root })
  const found =
    findFileRecursive(root, ['whisper-cli.exe', 'whisper-cli']) ||
    findFileRecursive(root, ['main.exe', 'main'])
  if (!found || !isUsableWhisperCli(found)) {
    throw new Error('Whisper 引擎解压后未找到可用的 whisper-cli（可能只下到了弃用提示程序）')
  }
  try {
    unlinkSync(zipPath)
  } catch {
    // ignore
  }
  return finalizeWhisperCli(found)
}

async function ensureWhisperBinary(
  onProgress?: (message: string, percent?: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal)
  const cli = whisperCliPath()
  if (isUsableWhisperCli(cli)) {
    await clearMacQuarantine(cli)
    // 若根目录仍是旧 stub，用真实二进制覆盖
    const stable = installStableWhisperCli(cli)
    onProgress?.('Whisper 引擎已就绪', 100)
    return stable
  }
  if (!whisperBinaryLock) {
    whisperBinaryLock = installWhisperBinary(onProgress, signal)
      .then(async (path) => {
        onProgress?.('Whisper 引擎已就绪', 100)
        return path
      })
      .finally(() => {
        whisperBinaryLock = null
      })
  }
  return whisperBinaryLock
}

function isReadyWhisperModel(dest: string): boolean {
  return isUsableMediaFile(dest, MODEL_MIN_BYTES) && looksLikeGgmlModel(dest)
}

async function ensureWhisperModel(
  onProgress?: (message: string, percent?: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal)
  const dest = modelPath()
  if (isReadyWhisperModel(dest)) {
    onProgress?.('Whisper 模型已就绪', 100)
    return dest
  }
  if (!whisperModelLock) {
    whisperModelLock = (async () => {
      if (isReadyWhisperModel(dest)) {
        onProgress?.('Whisper 模型已就绪', 100)
        return dest
      }
      // 清掉无效半截/网页伪装文件，避免一直显示「下载中」却无法真正就绪
      if (existsSync(dest) && !isReadyWhisperModel(dest)) {
        try {
          unlinkSync(dest)
        } catch {
          // ignore
        }
      }
      onProgress?.('正在下载 Whisper 模型（约 500MB，仅首次）…', 0)
      await downloadWithMirrors(
        MODEL_URLS,
        dest,
        (p) => onProgress?.('正在下载 Whisper 模型（约 500MB，仅首次）…', p),
        signal,
        { minBytes: Math.min(MODEL_MIN_BYTES, MODEL_EXPECTED_BYTES), requireGgml: true },
      )
      if (!isReadyWhisperModel(dest)) {
        try {
          unlinkSync(dest)
        } catch {
          // ignore
        }
        throw new Error('Whisper 模型下载不完整，请到设置 → 网络与依赖中配置代理后重试')
      }
      onProgress?.('Whisper 模型已就绪', 100)
      return dest
    })().finally(() => {
      whisperModelLock = null
    })
  }
  return whisperModelLock
}

function fileBytes(path: string | null): number {
  if (!path || !existsSync(path)) return 0
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function safeFfmpegPath(): string | null {
  try {
    return ffmpegBinary()
  } catch {
    return null
  }
}

function isPathInside(parent: string, target: string): boolean {
  const normalizedParent = parent.replace(/[/\\]+$/, '')
  const normalizedTarget = target
  if (process.platform === 'win32') {
    return normalizedTarget.toLowerCase().startsWith(`${normalizedParent.toLowerCase()}\\`)
      || normalizedTarget.toLowerCase() === normalizedParent.toLowerCase()
  }
  return (
    normalizedTarget === normalizedParent || normalizedTarget.startsWith(`${normalizedParent}/`)
  )
}

function canDownloadEngine(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
}

function removeWhisperModelFiles(): void {
  const root = whisperRootDir()
  const dest = modelPath()
  if (existsSync(dest)) {
    unlinkSync(dest)
  }
  for (const name of readdirSync(root)) {
    if (name === MODEL_NAME) continue
    if (name.startsWith(`${MODEL_NAME}.`) && name.endsWith('.part')) {
      try {
        unlinkSync(join(root, name))
      } catch {
        // ignore
      }
    }
  }
}

/** 仅清理用户目录下的引擎产物，保留模型；不触碰系统/Homebrew 安装。 */
function removeWhisperEngineFiles(): void {
  const root = whisperRootDir()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === MODEL_NAME) continue
    if (entry.name.startsWith(`${MODEL_NAME}.`)) continue
    const full = join(root, entry.name)
    try {
      rmSync(full, { recursive: true, force: true })
    } catch {
      // ignore locked files; status refresh will reflect leftovers
    }
  }
}

export function removeWhisperDep(
  key: import('../../shared/network').WhisperDepKey,
): import('../../shared/network').WhisperDepsStatus {
  if (key === 'ffmpeg') {
    throw new Error('FFmpeg 随安装包提供（Win/Mac），无法在设置中删除；损坏时请重装应用')
  }
  if (key === 'model') {
    removeWhisperModelFiles()
    return getWhisperDepsStatus()
  }
  // engine
  const cli = whisperCliPath()
  const root = whisperRootDir()
  if (isExecutableFile(cli) && !isPathInside(root, cli)) {
    throw new Error(
      `当前 Whisper 引擎来自系统路径（${cli}），无法在应用内删除。请用系统包管理器卸载，或忽略此项后下载用户目录版本。`,
    )
  }
  removeWhisperEngineFiles()
  return getWhisperDepsStatus()
}

export function getWhisperDepsStatus(): import('../../shared/network').WhisperDepsStatus {
  const root = whisperRootDir()
  const engineCandidate = whisperCliPath()
  const enginePath = isUsableWhisperCli(engineCandidate) ? engineCandidate : null
  const engineManaged = Boolean(enginePath && isPathInside(root, enginePath))
  const model = modelPath()
  const modelExists = existsSync(model)
  const modelReady = isReadyWhisperModel(model)
  const ffmpegPath = safeFfmpegPath()
  const engineDownloadable = canDownloadEngine()
  const items: import('../../shared/network').WhisperDepItemStatus[] = [
    {
      key: 'ffmpeg',
      label: 'FFmpeg（音轨提取）',
      ready: Boolean(ffmpegPath),
      path: ffmpegPath,
      bytes: fileBytes(ffmpegPath),
      detail: ffmpegPath
        ? '随安装包提供，Win/Mac 通用'
        : '安装包内缺少 ffmpeg-static，请重装应用',
      managed: false,
      canDelete: false,
      canInstall: false,
    },
    {
      key: 'engine',
      label: 'Whisper 引擎',
      ready: Boolean(enginePath),
      path: enginePath,
      bytes: fileBytes(enginePath),
      detail: enginePath
        ? engineManaged
          ? '已就绪（用户目录，可删除/重下）'
          : '已就绪（系统安装，应用内不可删除）'
        : engineDownloadable
          ? '尚未下载，拆解前需安装'
          : '当前平台需自行安装 whisper-cli',
      managed: engineManaged || (!enginePath && engineDownloadable),
      canDelete: engineManaged,
      canInstall: engineDownloadable,
    },
    {
      key: 'model',
      label: 'Whisper 模型（ggml-small）',
      ready: modelReady,
      path: modelReady || modelExists ? model : null,
      bytes: fileBytes(model),
      detail: modelReady
        ? '已就绪（可删除/重下）'
        : modelExists
          ? '文件不完整或无效，请重新下载'
          : '约 500MB，Win/Mac 共用同一模型文件',
      managed: true,
      canDelete: modelExists || fileBytes(model) > 0,
      canInstall: true,
    },
  ]
  return {
    ready: items.every((item) => item.ready),
    items,
    whisperRoot: root,
    platform: process.platform,
  }
}

export async function installWhisperDeps(
  onProgress?: (message: string, percent?: number) => void,
  signal?: AbortSignal,
  input?: import('../../shared/network').NetworkDepsInstallInput,
): Promise<import('../../shared/network').WhisperDepsStatus> {
  throwIfAborted(signal)
  const key = input?.key
  const force = Boolean(input?.force)
  const targets: import('../../shared/network').WhisperDepKey[] = key
    ? [key]
    : ['ffmpeg', 'engine', 'model']

  if (force) {
    for (const target of targets) {
      if (target === 'ffmpeg') continue
      try {
        removeWhisperDep(target)
      } catch (error) {
        // 强制重装时：系统引擎删不掉则继续尝试下载用户目录版本
        if (target === 'engine' && error instanceof Error) {
          onProgress?.(error.message, 0)
          continue
        }
        throw error
      }
    }
  }

  onProgress?.('正在检查本地依赖…', 2)

  if (targets.includes('ffmpeg')) {
    const ffmpeg = safeFfmpegPath()
    if (!ffmpeg) {
      throw new Error('FFmpeg 随安装包提供，当前安装包内缺失；请重装应用（Win/Mac 均内置）')
    }
    onProgress?.('FFmpeg 已就绪', 8)
  }

  if (targets.includes('engine')) {
    if (!canDownloadEngine() && !isExecutableFile(whisperCliPath())) {
      throw new Error('当前平台不支持自动下载 Whisper 引擎，请自行安装 whisper-cli')
    }
    await ensureWhisperBinary(
      (message, percent) => onProgress?.(message, mapOverall(10, 40, percent)),
      signal,
    )
  }

  if (targets.includes('model')) {
    await ensureWhisperModel(
      (message, percent) => onProgress?.(message, mapOverall(50, 45, percent)),
      signal,
    )
  }

  onProgress?.('本地依赖已就绪', 100)
  return getWhisperDepsStatus()
}

function formatCommandFailure(
  code: number | null,
  stderr: string,
  stdout: string,
): Error {
  const unsigned = code != null && code < 0 ? code + 0x1_0000_0000 : code
  // STATUS_DLL_NOT_FOUND
  if (code === -1073741515 || unsigned === 0xc0000135 || code === 3221225781) {
    return new Error(
      'Whisper 引擎缺少运行库（DLL）。请到设置 → 网络与依赖删除引擎后重新下载，勿手动移动 whisper-cli.exe',
    )
  }
  if (/deprecated/i.test(stderr) || /deprecated/i.test(stdout)) {
    return new Error(
      '检测到 Whisper 弃用提示程序。请到设置 → 网络与依赖删除引擎后重新下载',
    )
  }
  return new Error(stderr.trim() || stdout.trim() || `命令失败（code ${String(code)}）`)
}

function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; signal?: AbortSignal; pathPrefix?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    throwIfAborted(options?.signal)
    const env = { ...process.env }
    if (options?.pathPrefix) {
      const key = process.platform === 'win32' ? 'Path' : 'PATH'
      const current = env[key] || env.PATH || ''
      env[key] = `${options.pathPrefix}${process.platform === 'win32' ? ';' : ':'}${current}`
      env.PATH = env[key]
    }
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env,
      windowsHide: true,
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    const onAbort = () => {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
    }
    options?.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      options?.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      options?.signal?.removeEventListener('abort', onAbort)
      if (options?.signal?.aborted) {
        const err = new Error('已取消')
        err.name = 'AbortError'
        reject(err)
        return
      }
      if (code === 0) resolve({ stdout, stderr })
      else reject(formatCommandFailure(code, stderr, stdout))
    })
  })
}

async function extractWav(
  videoPath: string,
  wavPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const ffmpeg = ffmpegBinary()
  if (process.platform !== 'win32') {
    try {
      await chmod(ffmpeg, 0o755)
    } catch {
      // ignore
    }
    await clearMacQuarantine(ffmpeg)
  }
  if (existsSync(wavPath)) {
    try {
      unlinkSync(wavPath)
    } catch {
      // ignore
    }
  }
  await runCommand(
    ffmpeg,
    ['-y', '-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', wavPath],
    { signal },
  )
  if (!isUsableMediaFile(wavPath, 1024)) throw new Error('音频提取失败')
}

/** 把子步骤 0-100 映射到总进度区间，避免引擎下完又从 0% 看起来像「重下」 */
function mapOverall(base: number, span: number, local?: number): number {
  if (local == null || Number.isNaN(local)) return base
  return Math.min(99, Math.round(base + (span * Math.min(100, Math.max(0, local))) / 100))
}

function parseWhisperJson(jsonPath: string): TranscriptResult {
  const raw = readFileSync(jsonPath, 'utf8')
  const parsed = JSON.parse(raw) as {
    transcription?: Array<{ offsets?: { from?: number; to?: number }; text?: string }>
    segments?: Array<{ offsets?: { from?: number; to?: number }; text?: string }>
  }
  const rows = parsed.transcription || parsed.segments || []
  const cues: TranscriptCue[] = []
  for (const row of rows) {
    const text = String(row.text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    const fromMs = Number(row.offsets?.from ?? 0)
    const toMs = Number(row.offsets?.to ?? fromMs)
    cues.push({
      startSec: Math.max(0, fromMs / 1000),
      endSec: Math.max(fromMs / 1000 + 0.2, toMs / 1000),
      text,
    })
  }
  return {
    cues,
    fullTranscript: cues
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }
}

function parseWhisperStdout(stdout: string): TranscriptResult {
  const cues: TranscriptCue[] = []
  const re =
    /\[(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?\s*-->\s*(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?\]\s*(.+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(stdout))) {
    const toSec = (h: string, m: string, s: string, ms?: string) =>
      Number(h) * 3600 +
      Number(m) * 60 +
      Number(s) +
      (ms ? Number(ms.padEnd(3, '0')) / 1000 : 0)
    const text = match[9]!.trim()
    if (!text) continue
    cues.push({
      startSec: toSec(match[1]!, match[2]!, match[3]!, match[4]),
      endSec: toSec(match[5]!, match[6]!, match[7]!, match[8]),
      text,
    })
  }
  return {
    cues,
    fullTranscript: cues
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }
}

export async function transcribeLocalVideo(input: {
  awemeId: string
  videoPath: string
  onProgress?: (message: string, percent?: number) => void
  signal?: AbortSignal
}): Promise<TranscriptResult> {
  throwIfAborted(input.signal)
  const wavPath = audioFilePath(input.awemeId)
  input.onProgress?.('正在提取音轨…', 5)
  await extractWav(input.videoPath, wavPath, input.signal)

  const cli = await ensureWhisperBinary(
    (message, percent) => input.onProgress?.(message, mapOverall(8, 22, percent)),
    input.signal,
  )
  const model = await ensureWhisperModel(
    (message, percent) => input.onProgress?.(message, mapOverall(30, 50, percent)),
    input.signal,
  )

  input.onProgress?.('正在语音转写（可能需要几分钟）…', 85)
  const outBase = join(whisperRootDir(), `${input.awemeId.replace(/[^\w.-]+/g, '_')}`)
  const jsonPath = `${outBase}.json`

  try {
    const cliDir = dirname(cli)
    const { stdout } = await runCommand(
      cli,
      ['-m', model, '-f', wavPath, '-l', 'zh', '-oj', '-of', outBase, '-np'],
      { cwd: cliDir, pathPrefix: cliDir, signal: input.signal },
    )

    if (existsSync(jsonPath)) {
      const result = parseWhisperJson(jsonPath)
      if (result.fullTranscript) return result
    }
    const fallback = parseWhisperStdout(stdout)
    if (fallback.fullTranscript) return fallback
    throw new Error('转写结果为空（视频可能无对白或人声过弱）')
  } finally {
    try {
      if (existsSync(wavPath)) unlinkSync(wavPath)
    } catch {
      // ignore
    }
    try {
      if (existsSync(jsonPath)) unlinkSync(jsonPath)
    } catch {
      // ignore
    }
  }
}
