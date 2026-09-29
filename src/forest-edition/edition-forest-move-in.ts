import type { ResidentAnalysis, ImageMask, VisionResponse } from './edition-forest-resident-types'
import './edition-forest-move-in.css'
import { normalizeResidentName } from './edition-forest-resident-names'

type Options = {
  root: HTMLElement
  onCreate: (photo: HTMLCanvasElement, analysis: ResidentAnalysis, name: string) => Promise<void>
  onOpen: (open: boolean) => void
}
export function createMoveIn({ root, onCreate, onOpen }: Options) {
  const button = document.createElement('button'); button.className = 'edition-forest-move-in'; button.type = 'button'
  button.innerHTML = '<span class="edition-forest-move-in__icon">✦</span> 행성 입주 <span class="edition-forest-move-in__arrow">↗</span>'
  root.append(button)
  const dialog = document.createElement('dialog'); dialog.className = 'edition-forest-studio space-studio'
  const titleId = `${root.dataset.examplePanel ?? 'forest'}-studio-title`
  dialog.setAttribute('aria-labelledby', titleId)
  dialog.innerHTML = `
    <header class="edition-forest-studio__header"><div><span>YOUR TICKET TO A LITTLE PLANET ✦</span><h2 id="${titleId}">작은 행성에, 새로운 친구.</h2></div><button type="button" class="edition-forest-studio__close" aria-label="입주 취소">×</button></header>
    <label class="edition-forest-studio__name-field"><span>주민 이름</span><input class="edition-forest-studio__name-input" type="text" maxlength="20" autocomplete="off" placeholder="어떤 이름으로 불러 드릴까요?"><small>비워 두면 주민 번호로 지어 드려요.</small></label>
    <div class="edition-forest-studio__split">
      <section class="edition-forest-studio__camera"><video autoplay muted playsinline></video><div class="edition-forest-studio__camera-wait"><span>◎</span><p>카메라를 연결하고 있어요</p><button type="button" class="edition-forest-studio__camera-retry" hidden>카메라 다시 연결</button></div><div class="edition-forest-studio__frame"></div><span class="edition-forest-studio__panel-label">01 <b>지금의 나</b></span><p class="edition-forest-studio__camera-guide">얼굴과 팔이 잘 보이게 서 주세요.<br>전신이 보이면 다리까지 더 잘 맞출 수 있어요.</p><div class="edition-forest-studio__count" aria-live="assertive" hidden>5</div><div class="edition-forest-studio__flash"></div></section>
      <button type="button" class="edition-forest-studio__drop"><span class="edition-forest-studio__panel-label">02 <b>되고 싶은 모습</b></span><img alt="선택한 주민 형태 이미지" hidden><span class="edition-forest-studio__upload"><span class="edition-forest-studio__plus">+</span><strong>어떤 모습으로 살아볼까요?</strong><span>이미지를 끌어 놓거나 클릭해서 선택하세요</span><small>캐릭터, 동물, 사람, 좋아하는 물건까지<br>한 가지 형체가 가운데에 있는 사진이 좋아요</small></span><span class="edition-forest-studio__file-name" hidden></span></button>
    </div>
    <footer class="edition-forest-studio__footer"><p class="edition-forest-studio__status" role="status">이미지를 넣으면 5초 뒤에 사진을 촬영해요.</p><span>사진은 이 기기 안에서만 사용됩니다.</span><button type="button" class="edition-forest-studio__retry" hidden>다시 촬영하기</button></footer>
    <input class="edition-forest-studio__file" type="file" accept="image/*" hidden>
    <div class="edition-forest-studio__working" hidden><div class="edition-forest-studio__seed">✦</div><span>MADE FROM YOU</span><h3>새로운 이웃이 태어나는 중</h3><p role="status">이미지를 살펴보고 있어요</p><div class="edition-forest-studio__progress"><i></i></div></div>`
  document.body.append(dialog)
  const q = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!
  const video = q<HTMLVideoElement>('video'); const input = q<HTMLInputElement>('input.edition-forest-studio__file[type="file"]'); const drop = q<HTMLButtonElement>('.edition-forest-studio__drop')
  const count = q('.edition-forest-studio__count'); const status = q('.edition-forest-studio__status'); const working = q('.edition-forest-studio__working')
  const cameraWait = q('.edition-forest-studio__camera-wait'); const cameraRetry = q<HTMLButtonElement>('.edition-forest-studio__camera-retry')
  const nameInput = q<HTMLInputElement>('.edition-forest-studio__name-input')
  const retry = q<HTMLButtonElement>('.edition-forest-studio__retry')
  let stream: MediaStream | null = null; let worker: Worker | null = null; let workerReady: Promise<void> | null = null
  let ready = false; let cameraStarting = false; let busy = false; let generation = 0; let photo: HTMLCanvasElement | null = null
  let selected: HTMLCanvasElement | null = null; let selectedName = ''; let imageURL = ''; let timer = 0; let workerTimeout = 0; let rejectAnalysis: ((error: Error) => void) | null = null
  function say(message: string) { status.textContent = message }
  function stopCamera() { stream?.getTracks().forEach(track => track.stop()); stream = null; video.pause(); video.srcObject = null; ready = false; cameraStarting = false }
  function cleanupWorker() { clearTimeout(workerTimeout); workerTimeout = 0; rejectAnalysis?.(new Error('cancelled')); rejectAnalysis = null; worker?.terminate(); worker = null; workerReady = null }
  function clearCountdown() { clearInterval(timer); timer = 0; count.hidden = true }
  function close() {
    ++generation; clearCountdown(); stopCamera(); cleanupWorker(); nameInput.value = ''; nameInput.disabled = false; busy = false; photo = null; selected = null
    if (imageURL) URL.revokeObjectURL(imageURL); imageURL = ''; input.value = ''
    if (dialog.open) dialog.close(); onOpen(false); button.focus()
  }
  function loadWorker() {
    if (workerReady) return workerReady
    const attempt = generation
    workerReady = (async () => {
      const { default: ResidentWorker } = await import('./edition-forest-resident.worker?worker')
      if (attempt !== generation || !dialog.open) throw new Error('cancelled')
      const instance = new ResidentWorker(); worker = instance
      await new Promise<void>((resolve, reject) => {
        rejectAnalysis = reject
        workerTimeout = window.setTimeout(() => { reject(new Error('인식 준비가 오래 걸리고 있어요. 다시 시도해 주세요.')); instance.terminate() }, 60000)
        instance.onmessage = (event: MessageEvent<VisionResponse>) => {
          if (event.data.type === 'progress' && !working.hidden) working.querySelector('p')!.textContent = event.data.message
          if (event.data.type === 'ready') { clearTimeout(workerTimeout); rejectAnalysis = null; resolve() }
          else if (event.data.type === 'error') { clearTimeout(workerTimeout); rejectAnalysis = null; reject(new Error(event.data.message)) }
        }
        instance.onerror = () => { clearTimeout(workerTimeout); rejectAnalysis = null; reject(new Error('이미지 인식을 준비하지 못했어요. 다시 시도해 주세요.')) }
        instance.postMessage({ type: 'init', base: new URL(import.meta.env.BASE_URL, location.href).href })
      })
    })()
    // Camera and upload remain usable while model assets initialize.
    void workerReady.catch(() => {})
    return workerReady
  }
  async function enableCamera() {
    if (cameraStarting || ready || !dialog.open) return
    cameraStarting = true; const attempt = generation; cameraWait.hidden = false; cameraRetry.hidden = true
    cameraWait.querySelector('p')!.textContent = '카메라를 연결하고 있어요'
    try {
      if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('카메라 사용을 위해 HTTPS 또는 localhost로 열어 주세요.')
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } } })
      if (attempt !== generation || !dialog.open) { acquired.getTracks().forEach(t => t.stop()); return }
      stream = acquired; video.srcObject = acquired; await video.play()
      if (attempt !== generation) return
      ready = true; cameraWait.hidden = true
      acquired.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (stream !== acquired) return
        clearCountdown(); stopCamera(); busy = false; drop.disabled = false; cameraWait.hidden = false; cameraRetry.hidden = false
        cameraWait.querySelector('p')!.textContent = '카메라 연결이 끊겼어요'; say('카메라를 다시 연결해 주세요.')
      }, { once: true })
      if (selected) startCountdown()
    } catch (error) {
      if (attempt !== generation) return
      stopCamera()
      cameraWait.querySelector('p')!.textContent = error instanceof Error && error.name === 'NotAllowedError' ? '카메라 권한을 허용해 주세요' : error instanceof Error ? error.message : '카메라를 연결하지 못했어요'
      cameraRetry.hidden = false
    } finally { if (attempt === generation) cameraStarting = false }
  }
  async function choose(file: File) {
    if (busy || !dialog.open) return
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|avif|gif|heic|heif)$/i.test(file.name)) { say('이미지 파일을 선택해 주세요.'); return }
    if (file.size > 25 * 1024 * 1024) { say('25MB 이하의 이미지를 선택해 주세요.'); return }
    const attempt = generation; const url = URL.createObjectURL(file); const image = new Image()
    try {
      image.src = url; await image.decode()
      if (attempt !== generation || !dialog.open) { URL.revokeObjectURL(url); return }
      if (imageURL) URL.revokeObjectURL(imageURL); imageURL = url
      const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight))
      selected = document.createElement('canvas'); selected.width = Math.max(1, Math.round(image.naturalWidth * scale)); selected.height = Math.max(1, Math.round(image.naturalHeight * scale))
      selected.getContext('2d')!.drawImage(image, 0, 0, selected.width, selected.height); selectedName = file.name
      const preview = q<HTMLImageElement>('.edition-forest-studio__drop img'); preview.src = url; preview.hidden = false
      q('.edition-forest-studio__upload').hidden = true; q('.edition-forest-studio__file-name').hidden = false; q('.edition-forest-studio__file-name').textContent = selectedName
      if (ready) startCountdown(); else say('이미지를 선택했어요. 카메라가 연결되면 5초 뒤 촬영해요.')
    } catch { URL.revokeObjectURL(url); say('이 이미지 형식을 열 수 없어요. JPG, PNG 또는 WebP로 다시 선택해 주세요.') }
  }
  function startCountdown() {
    if (!ready || !selected || busy || !dialog.open) return
    clearCountdown(); busy = true; drop.disabled = true; retry.hidden = true; let remaining = 5
    count.hidden = false; count.textContent = String(remaining); say('5초 후에 사진을 찍어요. 카메라를 바라봐 주세요.')
    const deadline = performance.now() + 5000
    timer = window.setInterval(() => {
      if (document.hidden) { clearCountdown(); busy = false; drop.disabled = false; retry.hidden = false; say('촬영을 잠시 멈췄어요. 다시 촬영하기를 눌러 주세요.'); return }
      remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000))
      count.textContent = String(remaining)
      if (remaining === 0) { clearCountdown(); void capture() }
    }, 100)
  }
  async function capture() {
    const attempt = generation; const residentName = normalizeResidentName(nameInput.value); nameInput.disabled = true
    try {
      if (!ready || !video.videoWidth || video.readyState < 2 || !selected) throw new Error('카메라를 다시 연결한 뒤 촬영해 주세요.')
      photo = document.createElement('canvas'); const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight))
      photo.width = Math.round(video.videoWidth * scale); photo.height = Math.round(video.videoHeight * scale)
      // Store exactly the mirrored image that was shown in the left panel.
      const context = photo.getContext('2d')!; context.translate(photo.width, 0); context.scale(-1, 1); context.drawImage(video, 0, 0, photo.width, photo.height)
      q('.edition-forest-studio__flash').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320 })
      video.pause(); working.hidden = false; working.querySelector('p')!.textContent = '사진을 찍었어요. 새로운 모습을 준비하고 있어요'
      const reference = selected; const snapshot = photo
      await loadWorker()
      if (generation !== attempt) return
      const pixels = reference.getContext('2d')!.getImageData(0, 0, reference.width, reference.height).data
      let transparent = 0
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 128) transparent++
      let alpha: ImageMask | undefined
      if (transparent > reference.width * reference.height * .03) alpha = { width: reference.width, height: reference.height, values: Uint8Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4 + 3]) }
      const [referenceBitmap, photoBitmap] = await Promise.all([createImageBitmap(reference), createImageBitmap(snapshot)])
      if (generation !== attempt || !worker) { referenceBitmap.close(); photoBitmap.close(); return }
      const analysis = await new Promise<ResidentAnalysis>((resolve, reject) => {
        rejectAnalysis = reject
        workerTimeout = window.setTimeout(() => { rejectAnalysis = null; reject(new Error('이미지 분석이 오래 걸리고 있어요. 더 작은 이미지로 다시 시도해 주세요.')) }, 75000)
        worker!.onmessage = (event: MessageEvent<VisionResponse>) => {
          const result = event.data
          if (result.type === 'progress') working.querySelector('p')!.textContent = result.message
          if (result.type === 'result') { clearTimeout(workerTimeout); rejectAnalysis = null; resolve(result.analysis) }
          if (result.type === 'error') { clearTimeout(workerTimeout); rejectAnalysis = null; reject(new Error(result.message)) }
        }
        worker!.onerror = () => { rejectAnalysis = null; reject(new Error('이미지 분석이 중단됐어요. 다시 시도해 주세요.')) }
        worker!.postMessage({ type: 'analyze', reference: referenceBitmap, photo: photoBitmap, alpha, focus: { x: .5, y: .5 } }, [referenceBitmap, photoBitmap])
      })
      if (attempt !== generation) return
      stopCamera(); cleanupWorker(); working.querySelector('p')!.textContent = '우리 행성에 어울리는 작은 친구를 만들고 있어요'
      // Let the progress label paint before constructing the model.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      if (attempt !== generation) return
      await onCreate(snapshot, analysis, residentName)
      if (attempt !== generation) return
      close()
    } catch (error) {
      if (attempt !== generation) return
      cleanupWorker(); nameInput.disabled = false; working.hidden = true; busy = false; drop.disabled = false; retry.hidden = false
      say(error instanceof Error ? error.message : '주민을 만들지 못했어요. 다시 촬영해 주세요.')
      if (stream) { void video.play().catch(() => {}); ready = true }
      else { cameraWait.hidden = false; cameraRetry.hidden = false }
    }
  }
  button.addEventListener('click', () => {
    ++generation; nameInput.value = ''; nameInput.disabled = false; busy = false; selected = null; photo = null; drop.disabled = false; retry.hidden = true; working.hidden = true; count.hidden = true
    q<HTMLImageElement>('.edition-forest-studio__drop img').hidden = true; q('.edition-forest-studio__upload').hidden = false; q('.edition-forest-studio__file-name').hidden = true
    say('이미지를 넣으면 5초 뒤에 사진을 촬영해요.'); dialog.showModal(); onOpen(true); void enableCamera(); void loadWorker()
  })
  q('.edition-forest-studio__close').addEventListener('click', close)
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  cameraRetry.addEventListener('click', () => { void enableCamera() })
  retry.addEventListener('click', () => { if (ready) startCountdown(); else void enableCamera() })
  drop.addEventListener('click', () => input.click())
  input.addEventListener('change', () => { const file = input.files?.[0]; if (file) void choose(file); input.value = '' })
  for (const event of ['dragenter', 'dragover']) drop.addEventListener(event, e => { e.preventDefault(); if (!busy) drop.classList.add('is-dragging') })
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'))
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('is-dragging'); const file = event.dataTransfer?.files[0]; if (file) void choose(file) })
  dialog.addEventListener('dragover', event => event.preventDefault())
  dialog.addEventListener('drop', event => event.preventDefault())
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !dialog.open || !working.hidden) return
    clearCountdown(); stopCamera(); busy = false; drop.disabled = false; cameraWait.hidden = false; cameraRetry.hidden = false
    cameraWait.querySelector('p')!.textContent = '카메라를 잠시 껐어요'; say('카메라를 다시 연결하면 촬영을 이어갈 수 있어요.')
  })
  window.addEventListener('pagehide', close)
  return { close, setDisabled(value: boolean) { button.disabled = value }, setCount(value: number) { button.setAttribute('aria-label', `행성 입주 · 현재 주민 ${value}명`) } }
}
