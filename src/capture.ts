import './capture.css'
import type { Context } from 'modern-screenshot'

type CaptureOptions = {
  stage: HTMLElement
  getCanvas: () => HTMLCanvasElement | null
  getName: () => string
  onPreviewChange?: (open: boolean) => void
  onRecordingChange?: (recording: boolean) => void
}

type RequestFrameTrack = MediaStreamTrack & { requestFrame?: () => void }

const userAgent = navigator.userAgent
// Every browser on iOS uses WebKit, including Chrome/Edge/Firefox branded apps.
// Keep those browsers on WebKit's timed canvas stream implementation.
const isIOS = /iP(?:hone|ad|od)/i.test(userAgent)
const isWebKit = isIOS || (/AppleWebKit/i.test(userAgent) && !/(Chrome|Chromium|Edg|OPR)/i.test(userAgent))
const isFirefox = /Firefox/i.test(userAgent)
const usesTimedCanvasStream = isWebKit || isFirefox
const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8)
const isConstrainedDevice = (navigator.hardwareConcurrency || 8) <= 4 || deviceMemory <= 4

export function createCapture({ stage, getCanvas, getName, onPreviewChange, onRecordingChange }: CaptureOptions) {
  const root = document.createElement('aside')
  root.className = 'capture'
  root.setAttribute('aria-label', '모든 예제의 사진 및 동영상 촬영')
  root.innerHTML = `      <div class="capture__capture-group">
        <span class="capture__timer" hidden>00:00</span>
        <button class="capture__shutter" type="button" aria-label="짧게 눌러 사진, 길게 눌러 동영상 촬영" aria-pressed="false"><span></span></button>
        <span class="capture__capture-hint">탭: 사진 · 길게: 동영상</span>
      </div>
    <p class="capture__status" role="status" aria-live="polite"></p>
    <div class="capture__flash" aria-hidden="true"></div>
    <dialog class="capture__result" aria-labelledby="capture-result-title">
      <header><div><p>INTERACTIVE WEB CAPTURE</p><h3 id="capture-result-title">방금 만든 순간</h3></div><button class="capture__close" type="button" aria-label="촬영 결과 닫기">×</button></header>
      <div class="capture__preview"></div>
      <div class="capture__save-actions"><a class="capture__download">파일 저장 ↓</a><button class="capture__share" type="button" hidden>공유 / 사진 앱에 저장 ↗</button></div>
      <p class="capture__save-note">파일 저장을 누르면 촬영한 파일을 다운로드합니다.</p>
    </dialog>`
  document.body.append(root)
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const shutter = q<HTMLButtonElement>('.capture__shutter')
  const timer = q<HTMLSpanElement>('.capture__timer')
  const status = q<HTMLParagraphElement>('.capture__status')
  const dialog = q<HTMLDialogElement>('.capture__result')
  const preview = q<HTMLDivElement>('.capture__preview')
  const download = q<HTMLAnchorElement>('.capture__download')
  const share = q<HTMLButtonElement>('.capture__share')
  const output = document.createElement('canvas')
  const ctx = output.getContext('2d', { alpha: false })!
  let screenshot: typeof import('modern-screenshot') | null = null
  let context: Context<HTMLElement> | null = null
  let contextSize = ''
  let snapshotTask: Promise<HTMLCanvasElement> | null = null
  let contextInvalidated = false
  let recorder: MediaRecorder | null = null
  let captureStream: MediaStream | null = null
  let captureTrack: RequestFrameTrack | null = null
  let usesManualFrames = false
  let preparing = false
  let finalizing = false
  let generation = 0
  let recordingStart = 0
  let animationFrame = 0
  let updating = false
  let lastSnapshot = 0
  let lastStreamFrame = 0
  let lastTimerSecond = -1
  let pendingStopTimer = 0
  let holdTimer = 0
  let pointer: number | null = null
  let longPressed = false
  let keyboardHeld = false
  let keyboardClickUntil = 0
  let resultUrl = ''
  let resultFile: File | null = null
  let statusTimer = 0
  let captureName = ''
  let recordingUI = false

  function say(message: string) {
    clearTimeout(statusTimer); status.textContent = message
    statusTimer = window.setTimeout(() => { status.textContent = '' }, 5000)
  }
  function clearContext() {
    if (context) screenshot?.destroyContext(context)
    context = null; contextSize = ''
  }
  async function snapshot(): Promise<HTMLCanvasElement> {
    if (snapshotTask) await snapshotTask.catch(() => {})
    const task = renderSnapshot()
    snapshotTask = task
    try { return await task }
    finally {
      if (snapshotTask === task) snapshotTask = null
      if (contextInvalidated) {
        contextInvalidated = false
        clearContext()
      }
    }
  }
  async function renderSnapshot() {
    const direct = getCanvas()
    if (direct) return direct
    screenshot ??= await import('modern-screenshot')
    const width = window.innerWidth; const height = window.innerHeight
    const size = `${width}:${height}`
    if (contextSize !== size) clearContext()
    context ??= await screenshot.createContext(stage, {
      width, height, scale: Math.min(devicePixelRatio || 1, 2, 1600 / Math.max(width, height)),
      timeout: 5000,
      filter: (node) => !(node instanceof HTMLElement && (node.hidden || node.classList.contains('capture') || node.classList.contains('example-controls') || node.classList.contains('guestbook-link'))),
    })
    contextSize = size
    return screenshot.domToCanvas(context)
  }
  function composite(source: HTMLCanvasElement) {
    const scale = Math.min(output.width / source.width, output.height / source.height)
    const dw = source.width * scale; const dh = source.height * scale
    ctx.fillStyle = '#10111d'; ctx.fillRect(0, 0, output.width, output.height)
    ctx.drawImage(source, (output.width - dw) / 2, (output.height - dh) / 2, dw, dh)
    if (usesManualFrames) captureTrack?.requestFrame?.()
  }
  function loop(now: number) {
    if (!recorder || recorder.state !== 'recording') return
    const seconds = Math.floor((now - recordingStart) / 1000)
    if (seconds !== lastTimerSecond) {
      lastTimerSecond = seconds
      timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    }
    if (seconds >= 180) { stopRecording(true); say('3분 촬영을 완료했어요. 영상을 저장해 주세요.'); return }
    const direct = getCanvas()
    if (isFirefox && !direct && now - lastStreamFrame >= 1000 / 24) {
      // DOM snapshots can take longer than the first recording chunk. Keep the
      // last complete image flowing until a new snapshot is ready, so a short
      // recording still receives frames instead of an empty WebM.
      ctx.drawImage(output, 0, 0)
      captureTrack?.requestFrame?.()
      lastStreamFrame = now
    }
    const directInterval = isConstrainedDevice ? 1000 / 24 : 1000 / 30
    const domInterval = isConstrainedDevice ? 125 : 1000 / 12
    if (direct && now - lastSnapshot >= directInterval) {
      lastSnapshot = now
      composite(direct)
    } else if (!direct && !updating && now - lastSnapshot >= domInterval) {
      updating = true; lastSnapshot = now
      const session = generation
      void snapshot().then((source) => {
        if (session === generation && recorder?.state === 'recording') composite(source)
      }).catch(() => { if (session === generation) { say('화면 촬영이 중단됐어요. 촬영된 부분을 저장합니다.'); stopRecording(true) } }).finally(() => { updating = false; if (!recorder && !preparing) clearContext() })
    }
    animationFrame = requestAnimationFrame(loop)
  }
  function showResult(blob: Blob, movie: boolean) {
    if (!blob.size) { say('촬영 파일이 비어 있어요. 다시 촬영해 주세요.'); return }
    onPreviewChange?.(true)
    preview.querySelector('video')?.pause(); preview.replaceChildren()
    if (resultUrl) URL.revokeObjectURL(resultUrl)
    const extension = movie ? blob.type.includes('mp4') ? 'mp4' : 'webm' : 'png'
    const name = `${captureName}-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`
    resultFile = new File([blob], name, { type: blob.type })
    resultUrl = URL.createObjectURL(blob)
    const media = document.createElement(movie ? 'video' : 'img')
    media.src = resultUrl
    if (media instanceof HTMLVideoElement) { media.controls = true; media.playsInline = true; media.preload = 'metadata'; media.loop = true }
    else media.alt = '현재 예제의 화면을 촬영한 사진'
    preview.append(media); download.href = resultUrl; download.download = name
    share.hidden = !navigator.canShare?.({ files: [resultFile] })
    q('.capture__save-note').textContent = share.hidden ? '파일 저장을 누르면 촬영한 파일을 다운로드합니다.' : '사진 앱에 넣으려면 공유를 누른 뒤 이미지 저장 또는 비디오 저장을 선택하세요.'
    if (!dialog.open) openDialog()
    download.focus()
  }
  async function takePhoto() {
    if (preparing || finalizing || recorder || dialog.open) return
    preparing = true; shutter.disabled = true; captureName = getName()
    try {
      const source = await snapshot()
      // Copy now: the live scene can continue drawing while PNG encoding completes.
      output.width = source.width; output.height = source.height; composite(source)
      const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'))
      q('.capture__flash').animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 280 })
      if (blob) showResult(blob, false)
      else say('사진을 저장하지 못했어요. 다시 촬영해 주세요.')
    } catch { say('화면을 촬영하지 못했어요. 다시 시도해 주세요.') }
    finally { preparing = false; shutter.disabled = false; clearContext() }
  }
  async function startRecording() {
    if (preparing || recorder || finalizing || dialog.open) return
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function' || typeof output.captureStream !== 'function') {
      say('이 브라우저에서는 동영상 촬영을 사용할 수 없어요. Safari, Chrome, Edge 또는 Firefox에서 열어 주세요.')
      return
    }
    preparing = true; captureName = getName(); const session = ++generation
    q('.capture__capture-hint').textContent = '촬영 준비 중…'
    try {
      const source = await snapshot()
      if (session !== generation) return
      // H.264 encoders require even output dimensions on some devices.
      output.width = Math.max(2, Math.floor(source.width / 2) * 2)
      output.height = Math.max(2, Math.floor(source.height / 2) * 2)
      composite(source)
      const mimeType = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      // Chromium can encode only frames that actually changed. WebKit and Firefox
      // keep their reliable timed-stream path for short recordings.
      captureStream = output.captureStream(usesTimedCanvasStream ? 24 : 0)
      captureTrack = captureStream.getVideoTracks()[0] as RequestFrameTrack
      usesManualFrames = !usesTimedCanvasStream && typeof captureTrack.requestFrame === 'function'
      if (!usesTimedCanvasStream && !usesManualFrames) {
        captureStream.getTracks().forEach((track) => track.stop())
        captureStream = output.captureStream(24)
        captureTrack = captureStream.getVideoTracks()[0] as RequestFrameTrack
      }
      const current = new MediaRecorder(captureStream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: isConstrainedDevice ? 3_000_000 : 4_000_000,
      })
      const chunks: Blob[] = []
      current.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      current.onerror = () => { say('영상 촬영 중 오류가 발생했어요. 저장 가능한 부분을 복구합니다.'); stopRecording(true) }
      current.onstop = () => {
        clearTimeout(pendingStopTimer); pendingStopTimer = 0
        captureStream?.getTracks().forEach((track) => track.stop()); captureStream = null
        captureTrack = null; usesManualFrames = false
        recorder = null; finalizing = false; shutter.disabled = false; setRecordingUI(false)
        if (!updating) clearContext()
        // Encoders can choose a higher H.264 level than the requested one for
        // larger canvases. Let playback inspect the file's actual codec metadata.
        const containerType = (current.mimeType || chunks[0]?.type || mimeType || 'video/webm').split(';')[0]
        if (chunks.length) showResult(new Blob(chunks, { type: containerType }), true)
        else say('영상이 너무 짧아요. 조금 더 길게 촬영해 주세요.')
      }
      // Firefox needs a shorter timeslice to finalize very short recordings
      // consistently; the other engines use larger chunks to reduce overhead.
      current.start(isFirefox ? 250 : 1000); recorder = current; recordingStart = performance.now()
      lastSnapshot = 0; lastStreamFrame = 0; lastTimerSecond = 0
      timer.textContent = '00:00'; setRecordingUI(true); composite(source); animationFrame = requestAnimationFrame(loop)
    } catch {
      captureStream?.getTracks().forEach((track) => track.stop()); captureStream = null
      captureTrack = null; usesManualFrames = false
      say('영상 촬영을 시작하지 못했어요. 다시 시도해 주세요.'); clearContext()
    }
    finally { preparing = false; if (!recorder) { setRecordingUI(false); if (!updating) clearContext() } }
  }
  function setRecordingUI(recording: boolean) {
    if (recordingUI !== recording) {
      recordingUI = recording
      onRecordingChange?.(recording)
    }
    shutter.classList.toggle('is-recording', recording); shutter.setAttribute('aria-pressed', String(recording))
    shutter.setAttribute('aria-label', recording ? '동영상 촬영 종료 및 저장' : '짧게 눌러 사진, 길게 눌러 동영상 촬영')
    timer.hidden = !recording
    q('.capture__capture-hint').textContent = recording ? '한 번 더 눌러 촬영 종료' : '탭: 사진 · 길게: 동영상'
  }
  function stopRecording(force = false) {
    if (!force && recorder?.state === 'recording') {
      // Give each encoder enough frames to emit a valid first chunk. Firefox
      // needs a longer cluster; Chromium/WebKit still need about one second for
      // very short keyboard or touch recordings.
      const minimumDuration = isFirefox ? 2000 : 1000
      const remaining = minimumDuration - (performance.now() - recordingStart)
      if (remaining > 0) {
        if (!pendingStopTimer) {
          finalizing = true; shutter.disabled = true; setRecordingUI(false)
          pendingStopTimer = window.setTimeout(() => stopRecording(true), remaining)
        }
        return
      }
    }
    ++generation; cancelAnimationFrame(animationFrame)
    if (recorder && recorder.state !== 'inactive') {
      finalizing = true; shutter.disabled = true
      // Firefox can omit the final cluster from very short canvas recordings
      // unless it is requested before stop. WebKit must flush through stop only.
      if (isFirefox) {
        try { recorder.requestData() } catch { /* stop() remains the fallback */ }
      }
      recorder.stop(); setRecordingUI(false)
    }
  }
  function beginPress() {
    if (recorder || preparing) { longPressed = true; stopRecording(); return }
    longPressed = false; holdTimer = window.setTimeout(() => { longPressed = true; void startRecording() }, 450)
  }
  function finishPress(cancelled = false) {
    clearTimeout(holdTimer); if (!cancelled && !longPressed) void takePhoto()
    pointer = null; keyboardHeld = false
  }
  // These controls must not trigger sampler shortcuts, claw drops, or heart effects.
  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'keyup']) root.addEventListener(event, (e) => e.stopPropagation())
  shutter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointer !== null || keyboardHeld || shutter.disabled) return
    event.preventDefault(); pointer = event.pointerId; shutter.setPointerCapture(event.pointerId); beginPress()
  })
  shutter.addEventListener('pointerup', (event) => { if (event.pointerId === pointer) finishPress() })
  shutter.addEventListener('pointercancel', () => finishPress(true))
  shutter.addEventListener('lostpointercapture', () => { if (pointer !== null) finishPress(true) })
  shutter.addEventListener('contextmenu', (event) => event.preventDefault())
  shutter.addEventListener('keydown', (event) => {
    if (![' ', 'Enter'].includes(event.key)) return
    event.preventDefault(); if (event.repeat || keyboardHeld || pointer !== null) return
    keyboardHeld = true; beginPress()
  })
  shutter.addEventListener('keyup', (event) => { if ([' ', 'Enter'].includes(event.key) && keyboardHeld) { event.preventDefault(); keyboardClickUntil = performance.now() + 100; finishPress() } })
  shutter.addEventListener('click', (event) => { if (event.detail === 0 && !keyboardHeld && performance.now() > keyboardClickUntil) { if (recorder) stopRecording(); else void takePhoto() } })
  shutter.addEventListener('blur', () => { if (keyboardHeld) finishPress(true) })
  function openDialog() {
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }
  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close()
    else { dialog.removeAttribute('open'); dialog.dispatchEvent(new Event('close')) }
  }
  q('.capture__close').addEventListener('click', closeDialog)
  dialog.addEventListener('close', () => { preview.querySelector('video')?.pause(); onPreviewChange?.(false); shutter.focus() })
  share.addEventListener('click', async () => {
    if (!resultFile) return
    try { await navigator.share({ files: [resultFile], title: 'Interactive Web' }) }
    catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) q('.capture__save-note').textContent = '공유를 열지 못했어요. 파일 저장 버튼으로 저장해 주세요.' }
  })
  document.addEventListener('visibilitychange', () => { if (document.hidden) { finishPress(true); stopRecording(true) } })
  window.addEventListener('pagehide', () => { finishPress(true); stopRecording(true) })

  return {
    invalidate() {
      if (snapshotTask) contextInvalidated = true
      else clearContext()
      lastSnapshot = 0
    },
  }
}
