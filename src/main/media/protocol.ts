import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { net, protocol } from 'electron'

import { parseFluxMediaAwemeId } from '../../shared/media'
import { isUsableMediaFile, videoFilePath } from './paths'

let registered = false

/** Must be called before app ready */
export function registerFluxMediaSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'flux-media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true,
      },
    },
  ])
}

/**
 * Serve local MP4 via Chromium's file fetch so <video> Range seeking works.
 * Manual createReadStream Responses often fail to play in Electron.
 */
export function registerFluxMediaProtocol(): void {
  if (registered) return
  registered = true

  protocol.handle('flux-media', async (request) => {
    const awemeId = parseFluxMediaAwemeId(request.url)
    if (!awemeId) return new Response('Not Found', { status: 404 })

    const filePath = videoFilePath(awemeId)
    if (!existsSync(filePath) || !isUsableMediaFile(filePath)) {
      return new Response('Media not cached', { status: 404 })
    }

    try {
      return await net.fetch(pathToFileURL(filePath).href)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Read failed'
      return new Response(message, { status: 500 })
    }
  })
}
