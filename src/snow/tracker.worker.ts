import { releaseTrackingFrame, type TrackingFrame } from '../vision-frame'
import { FilesetResolver, FaceLandmarker, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision'
import type { HumanMask } from './types'

type Input = { type: 'init'; base: string; constrained: boolean } | { type: 'frame'; bitmap: TrackingFrame; timestamp: number }
let face: FaceLandmarker | null = null, hands: HandLandmarker | null = null, human: ImageSegmenter | null = null
let lastSegmentation = -Infinity, segmentationInterval = 160, selfieIndex = 0
// Load the project's local WASM glue in a module worker, as in the existing
// hand tracker. Inference runs here rather than blocking camera animation.
;(self as typeof self & { import: (url: string) => Promise<void> }).import = async url => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Vision runtime: ${response.status}`)
  const source = await response.text()
  ;(0, eval)(`${source}\n;self.ModuleFactory=ModuleFactory;`)
}
self.addEventListener('message', async (event: MessageEvent<Input>) => {
  const message = event.data
  if (message.type === 'init') {
    try {
      segmentationInterval = message.constrained ? 240 : 160
      const files = await FilesetResolver.forVisionTasks(`${message.base}mediapipe/wasm`)
      face = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${message.base}mediapipe/face_landmarker.task`, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5,
      })
      hands = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${message.base}mediapipe/hand_landmarker.task`, delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: .45, minHandPresenceConfidence: .45, minTrackingConfidence: .45,
      })
      human = await ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${message.base}mediapipe/selfie_segmenter.tflite`, delegate: 'CPU' },
        runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true,
      })
      selfieIndex = human.getLabels().findIndex(label => label.toLowerCase() === 'selfie')
      if (selfieIndex < 0) throw new Error('HumanSeg selfie confidence mask is unavailable')
      self.postMessage({ type: 'ready' })
    } catch (error) {
      face?.close(); hands?.close(); human?.close(); face = null; hands = null; human = null
      self.postMessage({ type: 'error', message: String(error) })
    }
    return
  }
  try {
    if (!face || !hands || !human) throw new Error('Vision trackers are not ready')
    const faceResult = face.detectForVideo(message.bitmap, message.timestamp)
    const handResult = hands.detectForVideo(message.bitmap, message.timestamp)
    let body: HumanMask | undefined
    if (message.timestamp - lastSegmentation >= segmentationInterval) {
      const result = human.segmentForVideo(message.bitmap, message.timestamp)
      try {
        const confidence = result.confidenceMasks?.[selfieIndex]
        if (!confidence) throw new Error('HumanSeg did not return its confidence mask')
        const values = confidence.getAsFloat32Array()
        const width = Math.min(224, confidence.width), height = Math.max(2, Math.round(confidence.height * width / confidence.width))
        const reduced = new Uint8Array(width * height)
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const mx = Math.min(confidence.width - 1, Math.floor((x + .5) / width * confidence.width))
          const my = Math.min(confidence.height - 1, Math.floor((y + .5) / height * confidence.height))
          reduced[y * width + x] = Math.round(values[my * confidence.width + mx] * 255)
        }
        body = { width, height, values: reduced }; lastSegmentation = message.timestamp
      } finally { result.close() }
    }
    // The app's shared tsconfig uses DOM rather than worker globals.
    const scope = self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }
    scope.postMessage({ type: 'result', timestamp: message.timestamp,
      hands: handResult.landmarks.map((landmarks, index) => ({
        id: handResult.handedness[index]?.[0]?.categoryName ?? String(index), landmarks, world: handResult.worldLandmarks[index],
      })), face: faceResult.faceLandmarks[0] ?? [], body,
    }, body ? [body.values.buffer as ArrayBuffer] : [])
  } catch (error) { self.postMessage({ type: 'error', message: String(error) }) }
  finally { releaseTrackingFrame(message.bitmap) }
})
