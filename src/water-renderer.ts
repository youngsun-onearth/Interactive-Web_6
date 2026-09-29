import type { WaterSurface } from './water-surface'

const vertex = `attribute vec2 position;
varying vec2 uv;
void main() { uv = vec2(position.x * .5 + .5, .5 - position.y * .5); gl_Position = vec4(position, 0., 1.); }`
const fragment = `precision mediump float;
varying vec2 uv;
uniform sampler2D camera;
uniform sampler2D water;
uniform vec2 crop;
uniform vec2 aspect;
void main() {
  vec2 slope = (texture2D(water, uv).rg * 255. - 128.) / 190.;
  vec2 bent = clamp(uv + slope * .095 / aspect, .001, .999);
  vec2 cameraUV = (bent - .5) * crop + .5;
  cameraUV.x = 1. - cameraUV.x;
  vec3 color = texture2D(camera, cameraUV).rgb;
  float light = clamp(dot(slope, vec2(-.65, -.9)), -.18, .23);
  color += light * vec3(.66, .86, 1.);
  gl_FragColor = vec4(color, 1.);
}`

export function createWaterRenderer(canvas: HTMLCanvasElement) {
  const userAgent = navigator.userAgent
  const isIOS = /iP(?:hone|ad|od)/i.test(userAgent)
  const needsVideoSnapshot = isIOS || (/AppleWebKit/i.test(userAgent) && !/(Chrome|Chromium|Edg|OPR)/i.test(userAgent))
  const output = canvas.getContext('2d', { alpha: false, desynchronized: true })!
  const gpuCanvas = document.createElement('canvas')
  gpuCanvas.className = canvas.className
  gpuCanvas.setAttribute('aria-label', canvas.getAttribute('aria-label') || '')
  let gl = gpuCanvas.getContext('webgl', { alpha: false, depth: false, antialias: false, powerPreference: 'default' })
  let program: WebGLProgram | null = null
  let cameraTexture: WebGLTexture | null = null
  let waterTexture: WebGLTexture | null = null
  let buffer: WebGLBuffer | null = null
  let cropUniform: WebGLUniformLocation | null = null
  let aspectUniform: WebGLUniformLocation | null = null
  let sourceTime = -1
  let fieldSize = ''
  let fieldRevision = -1
  let mountedGPU = false
  let capturing = false
  const shaders: WebGLShader[] = []
  const source = document.createElement('canvas')
  const sourceCtx = source.getContext('2d', { willReadFrequently: true })!
  let pixels: ImageData | null = null
  gpuCanvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    gl = null
    // Keep the original 2D canvas visible so the software renderer can take
    // over on the next frame instead of leaving a lost WebGL canvas onscreen.
    unmountGPU()
  })

  try {
    if (gl) {
      const compile = (type: number, code: string) => {
        const shader = gl!.createShader(type)!
        shaders.push(shader); gl!.shaderSource(shader, code); gl!.compileShader(shader)
        if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error('Water shader compilation failed')
        return shader
      }
      program = gl.createProgram()!
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex))
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment))
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Water shader link failed')
      gl.useProgram(program)
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      const position = gl.getAttribLocation(program, 'position')
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
      const texture = (unit: number) => {
        const result = gl!.createTexture()
        gl!.activeTexture(unit); gl!.bindTexture(gl!.TEXTURE_2D, result)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
        return result
      }
      cameraTexture = texture(gl.TEXTURE0); waterTexture = texture(gl.TEXTURE1)
      gl.uniform1i(gl.getUniformLocation(program, 'camera'), 0)
      gl.uniform1i(gl.getUniformLocation(program, 'water'), 1)
      cropUniform = gl.getUniformLocation(program, 'crop')
      aspectUniform = gl.getUniformLocation(program, 'aspect')
    }
  } catch { gl?.getExtension('WEBGL_lose_context')?.loseContext(); gl = null }

  function mountGPU() {
    if (mountedGPU || !canvas.isConnected) return
    canvas.replaceWith(gpuCanvas); mountedGPU = true
  }
  function unmountGPU() {
    if (!mountedGPU) return
    if (gpuCanvas.isConnected) gpuCanvas.replaceWith(canvas)
    mountedGPU = false
  }

  function resize(width: number, height: number) {
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    if (gpuCanvas.width !== width || gpuCanvas.height !== height) {
      gpuCanvas.width = width; gpuCanvas.height = height
      gl?.viewport(0, 0, width, height)
    }
  }

  function draw(video: HTMLVideoElement | null, surface: WaterSurface) {
    const w = canvas.width; const h = canvas.height
    if (!video || video.readyState < 2) {
      unmountGPU()
      const gradient = output.createLinearGradient(0, 0, w, h)
      gradient.addColorStop(0, '#102a38'); gradient.addColorStop(0.55, '#27525e'); gradient.addColorStop(1, '#0a1929')
      output.fillStyle = gradient; output.fillRect(0, 0, w, h)
      return
    }
    const normals = surface.encode()
    const scale = Math.max(w / video.videoWidth, h / video.videoHeight)
    if (gl && program && !gl.isContextLost()) {
      try {
        if (gpuCanvas.width !== w || gpuCanvas.height !== h) { gpuCanvas.width = w; gpuCanvas.height = h; gl.viewport(0, 0, w, h) }
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cameraTexture)
        if (sourceTime !== video.currentTime) {
          if (needsVideoSnapshot) {
            // WebKit can recycle a live video's GPU buffer while canvas
            // recording reads it, producing green frames when uploaded directly.
            const ratio = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight))
            const sw = Math.round(video.videoWidth * ratio); const sh = Math.round(video.videoHeight * ratio)
            if (source.width !== sw || source.height !== sh) { source.width = sw; source.height = sh }
            sourceCtx.drawImage(video, 0, 0, sw, sh)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
          } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video)
          }
          sourceTime = video.currentTime
        }
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, waterTexture)
        const size = `${surface.width}:${surface.height}`
        if (fieldSize !== size) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, surface.width, surface.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, normals)
          fieldSize = size; fieldRevision = surface.version
        } else if (fieldRevision !== surface.version) {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, surface.width, surface.height, gl.RGBA, gl.UNSIGNED_BYTE, normals)
          fieldRevision = surface.version
        }
        gl.uniform2f(cropUniform, w / (video.videoWidth * scale), h / (video.videoHeight * scale))
        gl.uniform2f(aspectUniform, w / Math.min(w, h), h / Math.min(w, h))
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        mountGPU()
        if (capturing) output.drawImage(gpuCanvas, 0, 0)
        return
      } catch { gl.getExtension('WEBGL_lose_context')?.loseContext(); gl = null; unmountGPU() }
    }
    // Canvas fallback also refracts the camera when WebGL is unavailable.
    const fw = Math.round(w * Math.min(1, 480 / Math.max(w, h)))
    const fh = Math.round(h * Math.min(1, 480 / Math.max(w, h)))
    if (source.width !== fw || source.height !== fh) { source.width = fw; source.height = fh; pixels = null }
    const fit = Math.max(fw / video.videoWidth, fh / video.videoHeight)
    sourceCtx.setTransform(-1, 0, 0, 1, fw, 0)
    sourceCtx.drawImage(video, (fw - video.videoWidth * fit) / 2, (fh - video.videoHeight * fit) / 2, video.videoWidth * fit, video.videoHeight * fit)
    sourceCtx.resetTransform()
    const original = sourceCtx.getImageData(0, 0, fw, fh)
    pixels ??= sourceCtx.createImageData(fw, fh)
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const i = (Math.floor(y / fh * surface.height) * surface.width + Math.floor(x / fw * surface.width)) * 4
      const sx = Math.max(0, Math.min(fw - 1, Math.round(x + (normals[i] - 128) / 190 * .095 * Math.min(fw, fh))))
      const sy = Math.max(0, Math.min(fh - 1, Math.round(y + (normals[i + 1] - 128) / 190 * .095 * Math.min(fw, fh))))
      const from = (sy * fw + sx) * 4; const to = (y * fw + x) * 4
      pixels.data[to] = original.data[from]; pixels.data[to + 1] = original.data[from + 1]; pixels.data[to + 2] = original.data[from + 2]; pixels.data[to + 3] = 255
    }
    sourceCtx.putImageData(pixels, 0, 0); output.drawImage(source, 0, 0, w, h)
  }

  return {
    draw,
    resize,
    setCapturing(value: boolean) { capturing = value },
    captureFrame() {
      if (mountedGPU && !capturing) output.drawImage(gpuCanvas, 0, 0)
      return canvas
    },
    dispose() {
      unmountGPU()
      if (gl) {
        gl.deleteTexture(cameraTexture); gl.deleteTexture(waterTexture); gl.deleteBuffer(buffer)
        shaders.forEach(shader => gl!.deleteShader(shader)); gl.deleteProgram(program)
        gl.getExtension('WEBGL_lose_context')?.loseContext(); gl = null
      }
      gpuCanvas.width = 1; gpuCanvas.height = 1; source.width = 1; source.height = 1; pixels = null
    },
  }
}
