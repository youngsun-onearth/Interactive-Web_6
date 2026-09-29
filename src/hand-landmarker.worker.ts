import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

type InitMessage = { type: 'init'; wasmPath: string; modelPath: string }
type FrameMessage = { type: 'frame'; bitmap: ImageBitmap; timestamp: number; width: number; height: number }
type CloseMessage = { type: 'close' }

let detector: HandLandmarker | null = null
// MediaPipe's WASM loader uses importScripts(), which module workers reject.
// Load the same local glue file in the worker global scope and expose its
// factory under the name expected by MediaPipe.
;(self as typeof self & { import: (url: string) => Promise<void> }).import = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to load hand-tracking runtime (${response.status})`)
  const source = await response.text()
  ;(0, eval)(`${source}\n;self.ModuleFactory=ModuleFactory;`)
}

self.addEventListener('message', async (event: MessageEvent<InitMessage | FrameMessage | CloseMessage>) => {
  if (event.data.type === 'init') {
    try {
      const files = await FilesetResolver.forVisionTasks(event.data.wasmPath)
      const options = {
        runningMode: 'VIDEO' as const,
        numHands: 2,
        minHandDetectionConfidence: .5,
        minHandPresenceConfidence: .5,
        minTrackingConfidence: .5,
      }
      // CPU inference stays off the UI thread and avoids contention between the
      // landmarker and the visible WebGL water renderer on mobile GPUs.
      detector = await HandLandmarker.createFromOptions(files, {
        ...options,
        baseOptions: { modelAssetPath: event.data.modelPath, delegate: 'CPU' },
      })
      self.postMessage({ type: 'ready' })
    } catch (error) {
      self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  if (event.data.type === 'close') {
    detector?.close(); detector = null; self.close(); return
  }

  const { bitmap, timestamp, width, height } = event.data
  try {
    if (!detector) throw new Error('Hand tracker is not ready')
    const result = detector.detectForVideo(bitmap, timestamp)
    self.postMessage({
      type: 'result',
      timestamp,
      width,
      height,
      landmarks: result.landmarks.slice(0, 2).map(hand => hand.map(point => ({ x: point.x, y: point.y, z: point.z }))),
    })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  } finally {
    bitmap.close()
  }
})
