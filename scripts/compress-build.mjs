import { readdir, readFile, writeFile, stat, mkdir, rm } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { gzip, gunzip, brotliCompress, brotliDecompress, constants } from 'node:zlib'

const zip = promisify(gzip), unzip = promisify(gunzip), brotli = promisify(brotliCompress), unbrotli = promisify(brotliDecompress)
const root = resolve('dist'), outputRoot = resolve('dist-compressed'), paths = []
await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isDirectory()) await walk(path)
    else if (item.isFile() && /\.(?:js|css|html|svg|json|wasm|tflite|task)$/.test(item.name) && item.name !== 'compression-report.json') paths.push(path)
  }
}
await walk(root)
const report = { encodingRequiresServerHeaders: true, files: [] }
let cursor = 0
async function worker() {
  for (;;) {
    const path = paths[cursor++]
    if (!path) return
    if ((await stat(path)).size < 1024) continue
    const raw = await readFile(path)
    const [gz, br] = await Promise.all([
      zip(raw, { level: 9 }),
      brotli(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
    ])
    const entry = { path: relative(root, path).replaceAll('\\', '/'), raw: raw.length }
    for (const [suffix, compressed, decode] of [['gz', gz, unzip], ['br', br, unbrotli]]) {
      if (compressed.length >= raw.length * .98) continue
      if (!(await decode(compressed)).equals(raw)) throw new Error(`Lossless compression failed: ${entry.path}.${suffix}`)
      const destination = join(outputRoot, `${relative(root, path)}.${suffix}`)
      await mkdir(resolve(destination, '..'), { recursive: true })
      await writeFile(destination, compressed)
      entry[suffix] = compressed.length
    }
    report.files.push(entry)
  }
}
// Keep build-time CPU and peak memory bounded even for the local ML models.
await Promise.all([worker(), worker()])
report.files.sort((a, b) => a.path.localeCompare(b.path))
await writeFile(join(outputRoot, 'compression-report.json'), JSON.stringify(report, null, 2) + '\n')
const sum = key => report.files.reduce((n, item) => n + (item[key] ?? item.raw), 0)
console.log(`Lossless build compression verified: ${(sum('raw') / 1e6).toFixed(2)} MB → Brotli ${(sum('br') / 1e6).toFixed(2)} MB / gzip ${(sum('gz') / 1e6).toFixed(2)} MB.`)
console.log('Compressed companions are in dist-compressed; the GitHub Pages dist artifact remains unchanged. Vite preview negotiates .br/.gz; other hosts require Content-Encoding and Vary headers.')
