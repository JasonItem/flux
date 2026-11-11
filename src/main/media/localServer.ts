import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { isUsableMediaFile, setMediaHttpPort, videoFilePath } from './paths'

let server: http.Server | null = null
let port = 0
let starting: Promise<number> | null = null

function bindServer(): Promise<number> {
  if (server && port > 0) return Promise.resolve(port)
  if (starting) return starting

  starting = new Promise<number>((resolve, reject) => {
    const next = http.createServer((req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405)
          res.end()
          return
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const match = /^\/v\/([^/]+)\.mp4$/i.exec(url.pathname)
        if (!match) {
          res.writeHead(404)
          res.end('Not Found')
          return
        }
        const awemeId = decodeURIComponent(match[1]!)
        const filePath = videoFilePath(awemeId)
        if (!existsSync(filePath) || !isUsableMediaFile(filePath)) {
          res.writeHead(404)
          res.end('Not cached')
          return
        }

        const { size } = statSync(filePath)
        const range = req.headers.range
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Type', 'video/mp4')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Access-Control-Allow-Origin', '*')

        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range)
          let start = m?.[1] ? Number(m[1]) : 0
          let end = m?.[2] ? Number(m[2]) : size - 1
          end = Math.min(end, size - 1)
          start = Math.max(0, Math.min(start, end))
          const chunk = end - start + 1
          res.writeHead(206, {
            'Content-Range': `bytes ${String(start)}-${String(end)}/${String(size)}`,
            'Content-Length': String(chunk),
          })
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          createReadStream(filePath, { start, end }).pipe(res)
          return
        }

        res.writeHead(200, { 'Content-Length': String(size) })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        createReadStream(filePath).pipe(res)
      } catch {
        if (!res.headersSent) res.writeHead(500)
        res.end('Error')
      }
    })

    next.once('error', (error) => {
      starting = null
      server = null
      reject(error)
    })

    next.listen(0, '127.0.0.1', () => {
      const addr = next.address() as AddressInfo | null
      if (!addr?.port) {
        starting = null
        reject(new Error('local media server failed to bind'))
        return
      }
      server = next
      port = addr.port
      setMediaHttpPort(port)
      starting = null
      console.log(`[studio] local media server http://127.0.0.1:${String(port)}`)
      resolve(port)
    })
  })

  return starting
}

/** Ensure loopback HTTP is listening (await on app ready). */
export async function ensureLocalMediaServer(): Promise<number> {
  return bindServer()
}

/** Sync helper after ensureLocalMediaServer has resolved. */
export function startLocalMediaServer(): number {
  if (server && port > 0) return port
  void bindServer().catch((error) => {
    console.error('[studio] local media server failed', error)
  })
  return port
}

export function localMediaPlayUrl(awemeId: string): string {
  const id = awemeId.trim()
  if (port <= 0) {
    void bindServer()
    return `flux-media://${encodeURIComponent(id)}`
  }
  return `http://127.0.0.1:${String(port)}/v/${encodeURIComponent(id)}.mp4`
}