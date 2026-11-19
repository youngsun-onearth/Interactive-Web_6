import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, relative, sep, extname, isAbsolute } from 'node:path'
import type { Plugin } from 'vite'

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.task': 'application/octet-stream',
}
function encodings(header: string) {
  const quality = new Map<string, number>()
  for (const part of header.split(',')) {
    const [name, ...parameters] = part.trim().toLowerCase().split(';')
    const q = parameters.find(p => p.trim().startsWith('q='))
    quality.set(name, q ? Number(q.trim().slice(2)) : 1)
  }
  return (['br', 'gzip'] as const).map(name => ({ name, q: quality.get(name) ?? quality.get('*') ?? 0 }))
    .filter(item => Number.isFinite(item.q) && item.q > 0).sort((a, b) => b.q - a.q)
}

// Precompressed files are generated separately so Pages does not upload unused
// duplicates. Local production preview can serve them with correct HTTP headers.
export function compressedAssetsPlugin(): Plugin {
  let dist = '', compressed = '', base = '/'
  return {
    name: 'verified-compressed-assets',
    configResolved(config) { dist = resolve(config.root, config.build.outDir); compressed = resolve(config.root, 'dist-compressed'); base = config.base },
    configurePreviewServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if ((request.method !== 'GET' && request.method !== 'HEAD') || request.headers.range) return next()
        let pathname: string
        try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://preview.invalid').pathname) }
        catch { return next() }
        if (!pathname.startsWith(base)) return next()
        const requested = pathname.slice(base.length) || 'index.html'
        const original = resolve(dist, requested), suffix = relative(dist, original)
        if (!suffix || isAbsolute(suffix) || suffix.startsWith(`..${sep}`) || suffix === '..' || suffix.includes('\0')) return next()
        const contentType = types[extname(original)]
        if (!contentType) return next()
        try {
          const sourceStat = await stat(original)
          if (!sourceStat.isFile()) return next()
          const vary = String(response.getHeader('Vary') ?? '').split(',').map(value => value.trim()).filter(Boolean)
          if (!vary.some(value => value.toLowerCase() === 'accept-encoding')) vary.push('Accept-Encoding')
          response.setHeader('Vary', vary.join(', '))
          for (const encoding of encodings(request.headers['accept-encoding'] ?? '')) {
            const path = resolve(compressed, `${suffix}.${encoding.name === 'br' ? 'br' : 'gz'}`)
            let compressedStat
            try { compressedStat = await stat(path) }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
            // A direct vite build without postprocessing must never serve older
            // compressed companions left from a previous source/build revision.
            if (!compressedStat.isFile() || compressedStat.mtimeMs < sourceStat.mtimeMs) continue
            response.setHeader('Content-Type', contentType); response.setHeader('Content-Encoding', encoding.name)
            response.setHeader('Cache-Control', suffix.startsWith(`assets${sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate')
            const etag = `W/"${compressedStat.size.toString(16)}-${Math.floor(compressedStat.mtimeMs).toString(16)}"`
            response.setHeader('ETag', etag); response.setHeader('Last-Modified', sourceStat.mtime.toUTCString())
            if ((request.headers['if-none-match'] ?? '').split(',').map(value => value.trim()).some(value => value === etag || value === '*')) {
              response.statusCode = 304; response.end(); return
            }
            response.setHeader('Content-Length', compressedStat.size)
            if (request.method === 'HEAD') { response.end(); return }
            createReadStream(path).on('error', error => { if (!response.headersSent) next(error); else response.destroy(error) }).pipe(response)
            return
          }
          next()
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return next()
          next(error)
        }
      })
    },
  }
}
