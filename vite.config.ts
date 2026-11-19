import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { playgroundPlugin } from './server/playground-plugin.ts'
import { compressedAssetsPlugin } from './server/compressed-assets.ts'

const certificate = resolve('certs/localhost.pem')
const privateKey = resolve('certs/localhost-key.pem')
const https = existsSync(certificate) && existsSync(privateKey)
  ? { cert: readFileSync(certificate), key: readFileSync(privateKey) }
  : undefined

export default defineConfig(({ command, isPreview }) => ({
  plugins: [playgroundPlugin(), compressedAssetsPlugin()],
  base: command === 'build' || isPreview ? '/Interactive-Web_6/' : '/',
  build: {
    target: 'es2020',
    cssTarget: ['chrome80', 'safari14', 'firefox78'],
    manifest: true,
    rolldownOptions: {
      input: { main: resolve('index.html'), guestbook: resolve('guestbook.html') },
    },
  },
  server: { host: true, https },
  preview: { host: true, https },
}))
