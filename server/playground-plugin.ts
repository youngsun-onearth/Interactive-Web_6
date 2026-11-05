import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { networkInterfaces } from 'node:os'
import { WebSocketServer, WebSocket } from 'ws'
import type { Plugin, ViteDevServer } from 'vite'
import { PlaygroundRoom, MAX_PLAYERS } from '../src/playground/simulation.ts'

// Attach to Vite's existing HTTP(S) listener: no extra port or separate command.
export function playgroundPlugin(): Plugin {
  const attach = (server: ViteDevServer['httpServer']) => {
    if (!server) return
    const room = new PlaygroundRoom()
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false })
    const peers = new Map<WebSocket, { id: string; alive: boolean; messages: number; joined: boolean }>()
    const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (request.url?.split('?')[0] !== '/__playground') return
      let sameOrigin = false
      try { sameOrigin = new URL(request.headers.origin ?? '').host === request.headers.host } catch { /* Invalid origin. */ }
      if (!sameOrigin || peers.size >= MAX_PLAYERS) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return
      }
      sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws))
    }
    server.on('upgrade', upgrade)
    sockets.on('connection', ws => {
      const peer = { id: randomUUID(), alive: true, messages: 0, joined: false }
      peers.set(ws, peer)
      const timeout = setTimeout(() => { if (!peer.joined) ws.close(1008, 'Join timeout') }, 8000)
      ws.on('pong', () => { peer.alive = true })
      ws.on('error', () => ws.terminate())
      ws.on('message', (raw, binary) => {
        if (binary || ++peer.messages > 100) { ws.close(1008, 'Invalid message rate'); return }
        let data
        try { data = JSON.parse(raw.toString()) } catch { return }
        if (!data || typeof data !== 'object') return
        if (data.type === 'join' && !peer.joined) {
          const player = room.join(peer.id, data.nickname)
          if (!player) { ws.close(1008, 'Nickname required or room full'); return }
          peer.joined = true; clearTimeout(timeout)
          ws.send(JSON.stringify({ type: 'welcome', id: peer.id, world: room.snapshot() }))
        } else if (peer.joined) room.command(peer.id, data)
      })
      ws.on('close', () => { clearTimeout(timeout); room.leave(peer.id); peers.delete(ws) })
    })
    let last = performance.now(), frame = 0
    const tick = setInterval(() => {
      const now = performance.now(); room.tick((now - last) / 1000); last = now
      if (++frame % 2) return
      const state = JSON.stringify({ type: 'state', world: room.world })
      for (const [ws, peer] of peers) {
        if (peer.joined && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 128_000) ws.send(state)
      }
    }, 1000 / 30)
    const rate = setInterval(() => { for (const p of peers.values()) p.messages = 0 }, 1000)
    const heartbeat = setInterval(() => {
      for (const [ws, peer] of peers) {
        if (!peer.alive) { ws.terminate(); continue }
        peer.alive = false; ws.ping()
      }
    }, 5000)
    server.once('close', () => {
      clearInterval(tick); clearInterval(rate); clearInterval(heartbeat)
      server.off('upgrade', upgrade)
      for (const ws of peers.keys()) ws.terminate()
      sockets.close()
    })
  }
  const info = (request: IncomingMessage, response: ServerResponse) => {
    const protocol = 'encrypted' in request.socket ? 'https:' : 'http:'
    const port = request.socket.localPort
    const origins = Object.values(networkInterfaces()).flatMap(addresses => (addresses ?? [])
      .filter(address => address.family === 'IPv4' && !address.internal)
      .map(address => `${protocol}//${address.address}:${port}`))
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.end(JSON.stringify({ origins }))
  }
  return { name: 'local-playground', configureServer: server => {
    attach(server.httpServer); server.middlewares.use('/__playground/info', info)
  }, configurePreviewServer: server => {
    attach(server.httpServer); server.middlewares.use('/__playground/info', info)
  } }
}
