import './style.css'
import { createScene } from './scene'
import { RIDES, RIDE_IDS, nearestRide, canPump, createWorld } from './simulation'
import type { World, Player, RideId } from './simulation'

export function createPlayground(panel: HTMLElement) {
  panel.innerHTML = `
    <div class="pg-viewport"></div>
    <header class="pg-heading"><span class="pg-eyebrow">06 / OUR LITTLE PLAYGROUND</span><h1>놀이터<span>함께 놀면 더 즐거워.</span></h1>
      <p class="pg-connection" role="status"><i></i><span>친구들을 만날 준비 중</span></p></header>
    <div class="pg-tools"><button class="pg-view" type="button" aria-pressed="true">전체 지도</button><button class="pg-share" type="button">초대 링크</button><button class="pg-leave" type="button" hidden>나가기</button></div>
    <div class="pg-entry"><form class="pg-entry-card">
      <span class="pg-card-tag">HELLO, NEW FRIEND!</span><h2>같이 놀러 갈까요?</h2>
      <p>커다란 얼굴, 작은 발걸음.<br>오늘의 랜덤 캐릭터가 기다리고 있어요.</p>
      <label for="pg-nickname">오늘의 닉네임</label>
      <input id="pg-nickname" name="nickname" maxlength="16" autocomplete="off" placeholder="어떻게 불러 드릴까요?" required aria-describedby="pg-entry-error" />
      <button class="pg-enter" type="submit">놀이터 입장하기 <span>↗</span></button>
      <p class="pg-entry-error" id="pg-entry-error" role="alert"></p>
      <div class="pg-entry-note"><span>매번 새로운 옷차림</span><span>같은 Wi-Fi에서 함께</span></div>
    </form></div>
    <div class="pg-invite" hidden><label for="pg-invite-url">같은 Wi-Fi에 연결한 친구에게 이 주소를 보내 주세요.</label><input id="pg-invite-url" readonly /><button type="button">닫기</button></div>
    <p class="pg-toast" role="status" hidden></p>
    <div class="pg-controls" hidden>
      <div class="pg-joystick" role="group" aria-label="터치 이동 조이스틱"><span class="pg-stick-guide" aria-hidden="true">↑<br>←　→<br>↓</span><span class="pg-stick" aria-hidden="true"></span></div>
      <span class="pg-move-hint">방향키 / WASD · 터치로 이동</span>
      <div class="pg-boarding" hidden><strong></strong><button class="pg-mount" type="button">탑승하기</button></div>
      <section class="pg-action" aria-label="탑승한 놀이기구 조작" hidden><div class="pg-action-copy"><span class="pg-action-eyebrow">LET’S PLAY</span><h2></h2><p></p></div>
        <p class="pg-timing" role="status" hidden></p>
        <div class="pg-meters" hidden><label>손아귀 힘 <meter class="pg-stamina" min="0" max="1" value="1"></meter></label><label>미끄러짐 <meter class="pg-slip" min="0" max="1" value="0"></meter></label></div>
        <div class="pg-action-buttons"><button class="pg-hold" type="button" aria-pressed="false" hidden>발 구르기</button><button class="pg-dismount" type="button" hidden>내리기</button></div>
      </section>
      <div class="pg-legend">${RIDE_IDS.map(id => `<span><i style="background:${RIDES[id].color}"></i>${RIDES[id].name}</span>`).join('')}</div>
    </div>`
  const element = <T extends HTMLElement = HTMLElement>(selector: string) => panel.querySelector<T>(selector)!
  const viewport = element('.pg-viewport'), entry = element('.pg-entry'), form = element<HTMLFormElement>('.pg-entry-card')
  const nickname = element<HTMLInputElement>('#pg-nickname'), enter = element<HTMLButtonElement>('.pg-enter')
  const error = element('.pg-entry-error'), connection = element('.pg-connection'), connectionText = element('.pg-connection span')
  const controls = element('.pg-controls'), leave = element<HTMLButtonElement>('.pg-leave'), view = element<HTMLButtonElement>('.pg-view')
  const mount = element<HTMLButtonElement>('.pg-mount'), dismount = element<HTMLButtonElement>('.pg-dismount'), hold = element<HTMLButtonElement>('.pg-hold')
  const boarding = element('.pg-boarding'), boardingName = element('.pg-boarding strong'), action = element('.pg-action'), timing = element('.pg-timing')
  const actionTitle = element('.pg-action h2'), actionText = element('.pg-action-copy p'), meters = element('.pg-meters')
  const stamina = element<HTMLMeterElement>('.pg-stamina'), slip = element<HTMLMeterElement>('.pg-slip')
  const joystick = element('.pg-joystick'), stick = element('.pg-stick'), toast = element('.pg-toast')
  const invite = element('.pg-invite'), inviteUrl = element<HTMLInputElement>('#pg-invite-url')
  const events = new AbortController()
  let disposed = false, socket: WebSocket | null = null, selfId = '', overview = true, joining = false
  let world: World = createWorld()
  let receivedAt = performance.now(), lastFrame = receivedAt, lastSent = 0, frame = 0, joinTimeout = 0, toastTimer = 0
  let joyId: number | null = null, joyX = 0, joyZ = 0, pointerHold = false, currentRide: RideId | null = null, lastNotice = ''
  const keys = new Set<string>()
  let graphics: ReturnType<typeof createScene>
  try { graphics = createScene(viewport) } catch {
    error.textContent = '3D 화면을 열 수 없어요. WebGL을 지원하는 브라우저에서 다시 열어 주세요.'
    enter.disabled = true; connectionText.textContent = '3D 그래픽을 사용할 수 없어요'
    return { canvas: null, dispose() { events.abort(); panel.replaceChildren() } }
  }
  const on = <K extends keyof WindowEventMap>(name: K, callback: (event: WindowEventMap[K]) => void) =>
    window.addEventListener(name, callback, { signal: events.signal })
  const send = (message: unknown) => { if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 8192) socket.send(JSON.stringify(message)) }
  const notify = (message: string) => {
    toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => { toast.hidden = true }, 4200)
  }
  const resetInput = () => {
    keys.clear(); joyX = 0; joyZ = 0; pointerHold = false
    if (joyId !== null && joystick.hasPointerCapture(joyId)) joystick.releasePointerCapture(joyId)
    joyId = null; stick.style.transform = 'translate(-50%, -50%)'
    hold.classList.remove('is-held'); hold.setAttribute('aria-pressed', 'false'); send({ type: 'input', x: 0, z: 0, hold: false })
  }
  function showEntry(message = '') {
    clearTimeout(joinTimeout); resetInput(); selfId = ''; joining = false
    world = { ...world, players: {} }; controls.hidden = true; entry.hidden = false; leave.hidden = true
    enter.disabled = false; error.textContent = message
    connection.classList.remove('is-online'); connectionText.textContent = message ? '연결을 확인해 주세요' : '친구들을 만날 준비 중'
    overview = true; graphics.setOverview(true); view.setAttribute('aria-pressed', 'true'); view.textContent = '전체 지도'
  }
  const disconnect = () => {
    const previous = socket; socket = null; previous?.close(1000, 'Left playground'); showEntry()
  }
  form.addEventListener('submit', event => {
    event.preventDefault()
    if (joining || disposed) return
    const name = nickname.value.trim()
    if (!name) { error.textContent = '닉네임을 입력해 주세요.'; nickname.focus(); return }
    joining = true; enter.disabled = true; error.textContent = ''; connectionText.textContent = '놀이터에 연결하는 중…'
    const url = new URL('/__playground', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(url); socket = ws
    joinTimeout = window.setTimeout(() => {
      if (socket !== ws || selfId) return
      socket = null; ws.close(); showEntry('연결하지 못했어요. 같은 Wi-Fi의 실행 중인 놀이터 주소인지 확인한 뒤 다시 입장해 주세요.')
    }, 8000)
    ws.onopen = () => { if (socket === ws) ws.send(JSON.stringify({ type: 'join', nickname: name })) }
    ws.onmessage = event => {
      if (disposed || socket !== ws) return
      let data
      try { data = JSON.parse(event.data) } catch { return }
      if ((data.type !== 'state' && data.type !== 'welcome') || !data.world?.players) return
      world = data.world; receivedAt = performance.now()
      if (data.type === 'welcome') {
        clearTimeout(joinTimeout); selfId = data.id; joining = false; lastNotice = ''
        entry.hidden = true; controls.hidden = false; leave.hidden = false; error.textContent = ''
        connection.classList.add('is-online'); overview = false; graphics.setOverview(false)
        view.setAttribute('aria-pressed', 'false'); view.textContent = '전체 지도'
        nickname.blur(); view.focus({ preventScroll: true })
        notify(`${name}, 반가워요! 가까운 놀이기구로 걸어가 보세요.`)
      }
      updateHud()
    }
    ws.onclose = () => {
      if (disposed || socket !== ws) return
      socket = null; showEntry('연결이 끊겼어요. 네트워크를 확인한 뒤 다시 입장해 주세요.')
    }
    ws.onerror = () => { /* onclose or the timeout presents the recoverable error. */ }
  }, { signal: events.signal })
  leave.addEventListener('click', disconnect, { signal: events.signal })
  view.addEventListener('click', () => {
    overview = !overview; graphics.setOverview(overview); view.setAttribute('aria-pressed', String(overview))
    view.textContent = overview ? '내 캐릭터 보기' : '전체 지도'
  }, { signal: events.signal })
  let shareUrl = new URL(location.href); shareUrl.hash = 'playground'
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    void fetch('/__playground/info', { signal: events.signal }).then(response => response.json()).then(data => {
      if (disposed || !Array.isArray(data.origins) || !data.origins.length) return
      const origin = new URL(data.origins[0]); shareUrl = new URL(shareUrl.pathname + '#playground', origin)
    }).catch(() => { /* The address field still works without a local host helper. */ })
  }
  element('.pg-share').addEventListener('click', async () => {
    inviteUrl.value = shareUrl.href; invite.hidden = false; inviteUrl.select()
    try { await navigator.clipboard.writeText(shareUrl.href); if (!disposed) notify('초대 링크를 복사했어요. 같은 Wi-Fi의 친구에게 보내 주세요.') }
    catch { if (!disposed) notify('주소를 길게 누르거나 선택해서 복사해 주세요.') }
  }, { signal: events.signal })
  element('.pg-invite button').addEventListener('click', () => { invite.hidden = true }, { signal: events.signal })
  function updateHud() {
    const self = world.players[selfId]
    if (!self) return
    connectionText.textContent = `${Object.keys(world.players).length}명 함께 노는 중 · ${self.nickname}`
    const rideId = self.riding?.id ?? nearestRide(self)
    currentRide = rideId
    action.hidden = !self.riding; dismount.hidden = !self.riding
    if (self.riding || !rideId) boarding.hidden = true
    hold.hidden = !self.riding || self.riding.id === 'slide'; meters.hidden = self.riding?.id !== 'spinner'
    timing.hidden = self.riding?.id !== 'swing' && self.riding?.id !== 'seesaw'
    joystick.classList.toggle('is-riding', Boolean(self.riding))
    if (!rideId) {
      actionTitle.textContent = '어디부터 가 볼까요?'; actionText.textContent = '놀이기구 가까이 다가가 보세요.'
      mount.disabled = true
    } else {
      const ride = RIDES[rideId], count = Object.values(world.players).filter(p => p.riding?.id === rideId).length
      actionTitle.textContent = `${ride.name} · ${count}/${ride.seats}`
      boardingName.textContent = `${ride.name} · ${count}/${ride.seats}`
      actionText.textContent = self.riding ? rideInstructions(self) : count >= ride.seats ? '친구가 내리면 함께 탈 수 있어요.' : '자리가 있어요. 같이 타 볼까요?'
      mount.disabled = count >= ride.seats; mount.textContent = count >= ride.seats ? '빈자리 기다리는 중' : '탑승하기'
      hold.textContent = rideId === 'spinner' ? '꽉 잡기 · SPACE' : '발 구르기 · SPACE'
      stamina.value = self.stamina; slip.value = self.slip
    }
    if (self.notice && self.notice !== lastNotice) notify(self.notice)
    lastNotice = self.notice
  }
  function rideInstructions(self: Player) {
    switch (self.riding!.id) {
      case 'swing': return '아래를 지날 때 SPACE를 한 번씩! 타이밍을 맞추면 360°까지.'
      case 'seesaw': return '내 쪽이 내려왔을 때 SPACE! 양쪽에서 번갈아 발을 굴러요.'
      case 'slide': return '계단을 올라가요. 꼭대기에 도착하면 슝!'
      case 'spinner': return `점점 빨라져요! ${Math.round(world.spinSpeed * 60 / (Math.PI * 2))} RPM · 손을 풀어 힘을 회복해요.`
    }
  }
  mount.addEventListener('click', () => { if (currentRide) send({ type: 'mount', ride: currentRide }) }, { signal: events.signal })
  dismount.addEventListener('click', () => { resetInput(); send({ type: 'dismount' }) }, { signal: events.signal })
  const pump = () => { send({ type: 'pump' }) }
  hold.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault(); pointerHold = true; hold.setPointerCapture(event.pointerId); hold.classList.add('is-held')
    const id = world.players[selfId]?.riding?.id
    if (id === 'swing' || id === 'seesaw') pump()
  }, { signal: events.signal })
  hold.addEventListener('click', event => {
    if (event.detail !== 0) return // Native keyboard/assistive activation only; pointerdown already kicked.
    const id = world.players[selfId]?.riding?.id
    if (id === 'swing' || id === 'seesaw') pump()
  }, { signal: events.signal })
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) hold.addEventListener(type, () => {
    pointerHold = false; hold.classList.remove('is-held')
  }, { signal: events.signal })
  const moveStick = (event: PointerEvent) => {
    const rect = joystick.getBoundingClientRect(), radius = rect.width * .31
    let x = event.clientX - rect.left - rect.width / 2, z = event.clientY - rect.top - rect.height / 2
    const scale = Math.max(1, Math.hypot(x, z) / radius); x /= scale; z /= scale
    joyX = x / radius; joyZ = z / radius
    stick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${z}px))`
  }
  joystick.addEventListener('pointerdown', event => {
    if (joyId !== null || !selfId || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault(); joyId = event.pointerId; joystick.setPointerCapture(event.pointerId); moveStick(event)
  }, { signal: events.signal })
  joystick.addEventListener('pointermove', event => { if (event.pointerId === joyId) moveStick(event) }, { signal: events.signal })
  const releaseStick = (event: PointerEvent) => {
    if (event.pointerId !== joyId) return
    joyId = null; joyX = 0; joyZ = 0; stick.style.transform = 'translate(-50%, -50%)'
  }
  joystick.addEventListener('pointerup', releaseStick, { signal: events.signal })
  joystick.addEventListener('pointercancel', releaseStick, { signal: events.signal })
  joystick.addEventListener('lostpointercapture', releaseStick, { signal: events.signal })
  const movementKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'])
  on('keydown', event => {
    if (!selfId || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey || event.altKey) return
    if (movementKeys.has(event.code)) { event.preventDefault(); keys.add(event.code) }
    if (event.code === 'Space' && world.players[selfId]?.riding && (!(event.target instanceof HTMLButtonElement) || event.target === hold)) {
      event.preventDefault()
      const fresh = !event.repeat && !keys.has('Space'); keys.add('Space')
      const id = world.players[selfId]?.riding?.id
      if (fresh && (id === 'swing' || id === 'seesaw')) pump()
    }
  })
  on('keyup', event => { keys.delete(event.code) })
  on('blur', resetInput)
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput() }, { signal: events.signal })
  on('pagehide', disconnect)
  const animate = (now: number) => {
    if (disposed) return
    const dt = Math.min(.05, (now - lastFrame) / 1000); lastFrame = now
    const elapsed = Math.min(.2, (now - receivedAt) / 1000)
    if (selfId && now - receivedAt > 5000) {
      const stalled = socket; socket = null; stalled?.close()
      showEntry('연결이 멈췄어요. 같은 Wi-Fi에 연결되어 있는지 확인하고 다시 입장해 주세요.')
    }
    if (selfId && now - lastSent > 50) {
      send({ type: 'input', x: joyX + Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA')),
        z: joyZ + Number(keys.has('ArrowDown') || keys.has('KeyS')) - Number(keys.has('ArrowUp') || keys.has('KeyW')),
        hold: world.players[selfId]?.riding?.id === 'spinner' && (pointerHold || keys.has('Space')) })
      hold.classList.toggle('is-held', pointerHold || keys.has('Space'))
      hold.setAttribute('aria-pressed', String(pointerHold || keys.has('Space'))); lastSent = now
    }
    if (!document.hidden) {
      const rendered: World = { ...world, time: world.time + elapsed, spinAngle: world.spinAngle + world.spinSpeed * elapsed,
        swings: world.swings.map(swing => ({ ...swing, angle: swing.angle + swing.velocity * elapsed })),
        seesawAngle: Math.max(-.5, Math.min(.5, world.seesawAngle + world.seesawVelocity * elapsed)) }
      graphics.render(rendered, selfId, dt)
      const self = world.players[selfId]
      if (self && !self.riding && currentRide) {
        const anchor = graphics.projectRide(currentRide)
        boarding.hidden = !anchor.visible
        boarding.style.left = `${anchor.x}px`; boarding.style.top = `${anchor.y}px`
      } else boarding.hidden = true
      if (self && !timing.hidden) {
        const ready = canPump(rendered, self)
        const recent = rendered.time - self.pumpAt < .6
        timing.dataset.state = recent ? self.pumpResult : ready ? 'ready' : 'wait'
        const cue = recent ? self.pumpResult === 'hit' ? '좋아요! 더 높이 올라가요 ✦' : '조금만 기다렸다 다시 굴러 보세요'
          : ready ? '지금! SPACE로 발 구르기' : self.riding?.id === 'seesaw' ? '내 쪽이 내려올 때까지 기다려요' : '가장 아래를 지날 때를 노려요'
        if (timing.textContent !== cue) timing.textContent = cue
        hold.classList.toggle('is-ready', ready)
      } else hold.classList.remove('is-ready')
    }
    frame = requestAnimationFrame(animate)
  }
  frame = requestAnimationFrame(animate)
  return { canvas: graphics.canvas, dispose() {
    disposed = true; events.abort(); resetInput(); socket?.close(1000, 'Changed example'); socket = null
    cancelAnimationFrame(frame); clearTimeout(joinTimeout); clearTimeout(toastTimer)
    graphics.dispose(); panel.replaceChildren()
  } }
}
