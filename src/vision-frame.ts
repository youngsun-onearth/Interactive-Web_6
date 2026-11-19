export type TrackingFrame = ImageBitmap | ImageData
let canvasBitmapSupported = typeof createImageBitmap === 'function'

// Older embedded WebKit engines may expose createImageBitmap but reject a
// video source or resize options. Canvas and transferable pixels preserve the
// same input dimensions and mirroring when the faster path is unavailable.
export async function createTrackingFrame(canvas: HTMLCanvasElement): Promise<TrackingFrame> {
  if (canvasBitmapSupported) {
    try { return await createImageBitmap(canvas) }
    catch { canvasBitmapSupported = false }
  }
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Camera frame canvas is unavailable')
  return context.getImageData(0, 0, canvas.width, canvas.height)
}
export function releaseTrackingFrame(frame: TrackingFrame) { if ('close' in frame) frame.close() }
export function trackingFrameTransfer(frame: TrackingFrame): Transferable[] {
  return 'data' in frame ? [frame.data.buffer as ArrayBuffer] : [frame]
}
export function postTrackingFrame(worker: Worker, message: { type: 'frame'; bitmap: TrackingFrame; timestamp: number; width: number; height: number }) {
  try { worker.postMessage(message, trackingFrameTransfer(message.bitmap)) }
  catch (error) { releaseTrackingFrame(message.bitmap); throw error }
}
export class VideoFrameSource {
  private directBitmap = typeof createImageBitmap === 'function'
  private canvas: HTMLCanvasElement | null = null
  async capture(video: HTMLVideoElement, maximum: number): Promise<TrackingFrame> {
    const scale = Math.min(1, maximum / Math.max(video.videoWidth, video.videoHeight))
    const width = Math.max(2, Math.round(video.videoWidth * scale)), height = Math.max(2, Math.round(video.videoHeight * scale))
    if (this.directBitmap) {
      try { return await createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' }) }
      catch { this.directBitmap = false }
    }
    this.canvas ??= document.createElement('canvas')
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    const context = this.canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Camera frame canvas is unavailable')
    context.drawImage(video, 0, 0, width, height)
    return createTrackingFrame(this.canvas)
  }
  release() { if (this.canvas) { this.canvas.width = this.canvas.height = 1; this.canvas = null } }
}
