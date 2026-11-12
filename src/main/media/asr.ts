import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
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
const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'

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

function whisperCliPath(): string {
  const root = whisperRootDir()
  const name = whisperCliName()
  const preferred = [
    join(root, 'Release', name),
    join(root, name),
    join(root, 'Release', process.platform === 'win32' ? 'main.exe' : 'main'),
  ]
  for (const candidate of preferred) {
    if (isExecutableFile(candidate)) return candidate
  }
  return join(root, name)
}

function modelPath(): string {
  return join(whisperRootDir(), MODEL_NAME)
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (percent?: number) => void,
): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true })
  const response = await net.fetch(url, { method: 'GET', redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(
      `下载失败（HTTP ${String(response.status)}）。若在国内网络，请开启系统代理后再试：${url}`,
    )
  }
  const total = Number(response.headers.get('content-length') || 0)
  let received = 0
  const nodeStream = Readable.fromWeb(response.body as never)
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) onProgress?.(Math.min(99, Math.round((received / total) * 100)))
  })
  // Unique temp avoids concurrent downloads clobbering the same .part
  const temp = `${dest}.${randomUUID()}.part`
  try {
    await pipeline(nodeStream, createWriteStream(temp))
    if (!existsSync(temp) || statSync(temp).size <= 0) {
      throw new Error('下载结果为空，请检查网络或代理后重试')
    }
    if (total > 0 && statSync(temp).size < Math.min(total, 1024)) {
      throw new Error('下载不完整，请检查网络后重试')
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
    throw error
  }
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
      if (isExecutableFile(candidate)) return candidate
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

async function installWhisperBinary(
  onProgress?: (message: string, percent?: number) => void,
): Promise<string> {
  const cli = whisperCliPath()
  if (isExecutableFile(cli)) {
    await clearMacQuarantine(cli)
    return cli
  }

  const bundled = bundledWhisperCandidate()
  if (bundled && isExecutableFile(bundled)) {
    mkdirSync(dirname(cli), { recursive: true })
    copyFileSync(bundled, cli)
    if (process.platform !== 'win32') await chmod(cli, 0o755)
    await clearMacQuarantine(cli)
    return cli
  }

  for (const candidate of systemWhisperCandidates()) {
    if (isExecutableFile(candidate)) return candidate
  }

  // Prefer system-installed whisper-cli if present on PATH
  const which = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await runCommand(which, [whisperCliName().replace('.exe', '')])
    const line = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean)
    if (line && isExecutableFile(line)) return line
  } catch {
    // continue to download
  }

  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    throw new Error(
      '未找到 whisper-cli。请安装 whisper.cpp（例如 brew install whisper-cpp），或将二进制放入 resources/whisper/。',
    )
  }

  onProgress?.('正在下载 Whisper 引擎…')
  const root = whisperRootDir()
  const zipPath = join(root, 'whisper-bin.zip')
  const zipUrl = process.platform === 'darwin' ? macWhisperZipUrl() : WHISPER_WIN_ZIP
  await downloadFile(zipUrl, zipPath, (p) => onProgress?.('正在下载 Whisper 引擎…', p))
  await extractZip(zipPath, { dir: root })
  const found =
    findFileRecursive(root, ['whisper-cli.exe', 'main.exe']) ||
    findFileRecursive(root, ['whisper-cli', 'main'])
  if (!found) throw new Error('Whisper 引擎解压后未找到可执行文件')
  // Keep binaries in their extracted folder (Release/) so sibling DLLs resolve.
  const resolved = existsSync(found) ? found : cli
  if (process.platform !== 'win32') await chmod(resolved, 0o755)
  await clearMacQuarantine(dirname(resolved))
  await clearMacQuarantine(resolved)
  try {
    unlinkSync(zipPath)
  } catch {
    // ignore
  }
  if (!existsSync(resolved)) throw new Error('Whisper 引擎安装失败')
  return resolved
}

async function ensureWhisperBinary(
  onProgress?: (message: string, percent?: number) => void,
): Promise<string> {
  const cli = whisperCliPath()
  if (isExecutableFile(cli)) {
    await clearMacQuarantine(cli)
    return cli
  }
  if (!whisperBinaryLock) {
    whisperBinaryLock = installWhisperBinary(onProgress).finally(() => {
      whisperBinaryLock = null
    })
  }
  return whisperBinaryLock
}

async function ensureWhisperModel(
  onProgress?: (message: string, percent?: number) => void,
): Promise<string> {
  const dest = modelPath()
  if (isUsableMediaFile(dest, 10_000_000)) return dest
  if (!whisperModelLock) {
    whisperModelLock = (async () => {
      if (isUsableMediaFile(dest, 10_000_000)) return dest
      onProgress?.('正在下载 Whisper 模型（约 500MB，仅首次）…')
      await downloadFile(MODEL_URL, dest, (p) =>
        onProgress?.('正在下载 Whisper 模型（约 500MB，仅首次）…', p),
      )
      return dest
    })().finally(() => {
      whisperModelLock = null
    })
  }
  return whisperModelLock
}

function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      windowsHide: true,
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr.trim() || stdout.trim() || `命令失败（code ${String(code)}）`))
    })
  })
}

async function extractWav(videoPath: string, wavPath: string): Promise<void> {
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
  await runCommand(ffmpeg, [
    '-y',
    '-i',
    videoPath,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    wavPath,
  ])
  if (!isUsableMediaFile(wavPath, 1024)) throw new Error('音频提取失败')
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
}): Promise<TranscriptResult> {
  const wavPath = audioFilePath(input.awemeId)
  input.onProgress?.('正在提取音轨…', 5)
  await extractWav(input.videoPath, wavPath)

  const cli = await ensureWhisperBinary((message, percent) =>
    input.onProgress?.(message, percent),
  )
  const model = await ensureWhisperModel((message, percent) =>
    input.onProgress?.(message, percent),
  )

  input.onProgress?.('正在语音转写（可能需要几分钟）…', 40)
  const outBase = join(whisperRootDir(), `${input.awemeId.replace(/[^\w.-]+/g, '_')}`)
  const jsonPath = `${outBase}.json`

  try {
    const { stdout } = await runCommand(
      cli,
      ['-m', model, '-f', wavPath, '-l', 'zh', '-oj', '-of', outBase, '-np'],
      { cwd: dirname(cli) },
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
