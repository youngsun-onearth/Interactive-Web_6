import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const certificate = resolve('certs/localhost.pem')
const privateKey = resolve('certs/localhost-key.pem')
const https = existsSync(certificate) && existsSync(privateKey)
  ? { cert: readFileSync(certificate), key: readFileSync(privateKey) }
  : undefined

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Interactive-Web_6/' : '/',
  build: {
    rolldownOptions: {
      input: { main: resolve('index.html'), guestbook: resolve('guestbook.html') },
    },
  },
  server: { host: true, https },
  preview: { host: true, https },
}))
