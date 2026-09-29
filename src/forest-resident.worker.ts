import { FilesetResolver, ImageClassifier, ImageSegmenter, InteractiveSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { VisionRequest, VisionResponse, ImageMask } from './forest-resident-types'
import { extractPlainBackgroundSubject, normalizeSubjectMask, suggestSubjectFocus } from './forest-subject-mask'

// Match the existing local MediaPipe worker loader (module workers have no importScripts).
;(self as typeof self & { import: (url: string) => Promise<void> }).import = async url => {
  const response = await fetch(url)
  if (!response.ok) throw new Error('인식 런타임을 불러오지 못했어요.')
  const source = await response.text()
  ;(0, eval)(`${source}\n;self.ModuleFactory=ModuleFactory;`)
}
const send = (message: VisionResponse) => self.postMessage(message)
let classifier: ImageClassifier
let human: ImageSegmenter
let silhouette: InteractiveSegmenter
let pose: PoseLandmarker
let poseOutputsMask = true
let ready: Promise<void> | null = null
async function setPoseMaskOutput(enabled: boolean) {
  if (poseOutputsMask === enabled) return
  await pose.setOptions({ outputSegmentationMasks: enabled })
  poseOutputsMask = enabled
}
function init(base: string) {
  return (async () => {
    const files = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`)
    const options = (model: string) => ({ modelAssetPath: `${base}mediapipe/${model}`, delegate: 'CPU' as const })
    // Sequential initialization avoids simultaneous WASM heap spikes.
    send({ type: 'progress', message: '사람의 모습을 알아볼 준비를 하고 있어요' })
    human = await ImageSegmenter.createFromOptions(files, { baseOptions: options('selfie_segmenter.tflite'), runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false })
    pose = await PoseLandmarker.createFromOptions(files, { baseOptions: options('pose_landmarker_lite.task'), runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true, minPoseDetectionConfidence: .35, minPosePresenceConfidence: .35 })
    poseOutputsMask = true
    send({ type: 'progress', message: '이미지의 형태를 알아볼 준비를 하고 있어요' })
    classifier = await ImageClassifier.createFromOptions(files, { baseOptions: options('efficientnet_lite0.tflite'), runningMode: 'IMAGE', maxResults: 5 })
    // Magic Touch has one foreground confidence channel. Its category output
    // uses 0/255, not the 0/1 indices implied by the packaged labels.txt.
    silhouette = await InteractiveSegmenter.createFromOptions(files, { baseOptions: options('magic_touch.tflite'), outputCategoryMask: false, outputConfidenceMasks: true })
    send({ type: 'ready' })
  })()
}
self.addEventListener('message', async (event: MessageEvent<VisionRequest>) => {
  const data = event.data
  if (data.type === 'init') {
    ready = init(data.base)
    await ready.catch(() => send({ type: 'error', message: '이미지 인식을 준비하지 못했어요. 다시 시도해 주세요.' }))
    return
  }
  let stage = '이미지 인식 준비'
  try {
    await ready
    stage = '촬영 사진의 사람 분리'
    send({ type: 'progress', message: '사진 속 사람의 배경을 지우고 있어요' })
    const result = human.segment(data.photo)
    let person: ImageMask
    try {
      const mask = result.confidenceMasks?.[0]
      if (!mask) throw new Error('사람의 모습을 찾지 못했어요. 밝은 곳에서 다시 촬영해 주세요.')
      person = { width: mask.width, height: mask.height, values: Uint8Array.from(mask.getAsFloat32Array(), n => Math.round(Math.max(0, Math.min(1, (n - .25) / .5)) * 255)) }
    } finally { result.close() }
    const coverage = person.values.reduce((total, n) => total + (n > 127 ? 1 : 0), 0) / person.values.length
    if (coverage < .018) throw new Error('사진에서 사람을 찾지 못했어요. 얼굴과 몸이 보이도록 다시 촬영해 주세요.')
    send({ type: 'progress', message: '얼굴과 팔다리의 위치를 맞추고 있어요' })
    stage = '촬영 사진의 얼굴과 자세 분석'
    await setPoseMaskOutput(true)
    const detectedPose = pose.detect(data.photo)
    const landmarks = detectedPose.landmarks[0] ?? []
    try {
      const bodyMask = detectedPose.segmentationMasks?.[0]
      if (bodyMask && landmarks.length) {
        const confidence = bodyMask.getAsFloat32Array()
        // HumanSeg is broad on distant full-body photos. Intersect with the detected body's mask,
        // keeping all atlas samples inside both boundaries rather than including nearby scenery.
        for (let y = 0; y < person.height; y++) for (let x = 0; x < person.width; x++) {
          const index = Math.min(bodyMask.height - 1, Math.floor(y / person.height * bodyMask.height)) * bodyMask.width + Math.min(bodyMask.width - 1, Math.floor(x / person.width * bodyMask.width))
          person.values[y * person.width + x] = Math.min(person.values[y * person.width + x], Math.round(Math.max(0, Math.min(1, (confidence[index] - .5) / .4)) * 255))
        }
      }
    } finally { detectedPose.close() }
    send({ type: 'progress', message: '이미지의 형태와 특징을 살펴보고 있어요' })
    stage = '업로드 이미지의 종류 분석'
    const categories = classifier.classify(data.reference).classifications[0]?.categories.map(c => ({ name: c.categoryName, score: c.score, index: c.index })) ?? []
    stage = '업로드 이미지의 자세 분석'
    // Only landmarks are needed here. The 0.10.32 pose-mask projection path
    // aborts with `1 == ChannelSize() (1 vs. 4)` on the portrait mannequin AVIF.
    // Disable that unnecessary output before feeding the reference image;
    // re-enable it above for the next camera photo if this worker is reused.
    await setPoseMaskOutput(false)
    const referencePoseResult = pose.detect(data.reference)
    const referencePose = referencePoseResult.landmarks[0] ?? []; referencePoseResult.close()
    stage = '업로드 이미지의 배경 분리'
    let reference: ImageMask | undefined
    if (data.alpha) reference = normalizeSubjectMask(data.alpha, true)
    else {
      // Keep thin outlines, fingers and legs at the uploaded image resolution.
      // The old 160px image was only used to choose AI prompts, so even a clean
      // white background still failed whenever all learned masks were empty.
      const ratio = Math.min(1, 640 / Math.max(data.reference.width, data.reference.height))
      const canvas = new OffscreenCanvas(Math.max(2, Math.round(data.reference.width * ratio)), Math.max(2, Math.round(data.reference.height * ratio)))
      const context = canvas.getContext('2d')!; context.drawImage(data.reference, 0, 0, canvas.width, canvas.height)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      reference = extractPlainBackgroundSubject(pixels, canvas.width, canvas.height)
      const prompts = reference ? [] : suggestSubjectFocus(pixels, canvas.width, canvas.height)
      if (referencePose[11]?.visibility > .6 && referencePose[12]?.visibility > .6) prompts.unshift({ x: (referencePose[11].x + referencePose[12].x) / 2, y: (referencePose[11].y + referencePose[12].y) / 2 + .025 })
      prompts.push(data.focus)
      for (const focus of prompts) {
        if (reference) break
        const segmented = silhouette.segment(data.reference, { keypoint: { x: Math.max(.01, Math.min(.99, focus.x)), y: Math.max(.01, Math.min(.99, focus.y)) } })
        try {
          const mask = segmented.confidenceMasks?.[0]
          // Read foreground probabilities directly instead of guessing category
          // indices. Exterior normalization still corrects a whitespace prompt.
          if (mask) reference = normalizeSubjectMask({ width: mask.width, height: mask.height, values: Uint8Array.from(mask.getAsFloat32Array(), n => n >= .5 ? 255 : 0) })
        } catch { /* Try another point on the subject; never accept a frame-shaped mask. */ }
        finally { segmented.close() }
        if (reference) break
      }
    }
    if (!reference) throw new Error('형체와 배경을 구분하지 못했어요. 배경이 단순한 이미지로 다시 시도해 주세요.')
    const foreground = reference.values.reduce((total, n) => total + (n > 127 ? 1 : 0), 0)
    if (foreground < 30) throw new Error('형체가 뚜렷한 이미지를 다시 선택해 주세요.')
    send({ type: 'result', analysis: { reference, person, referencePose, pose: landmarks, categories } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const runtimeFailure = /Aborted|WebAssembly|memory access|out of memory|Check failed|RuntimeError/i.test(message)
    console.error(`[forest-resident] ${stage}`, error)
    send({ type: 'error', message: runtimeFailure ? `${stage} 중 인식 엔진이 중단됐어요. 다시 촬영하기를 눌러 주세요.` : error instanceof Error ? error.message : '주민을 만드는 중 문제가 생겼어요. 다시 시도해 주세요.' })
  } finally { data.reference.close(); data.photo.close() }
})
