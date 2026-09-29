// Real MediaPipe regression, without an HTTP/development server.
// node tests/forest-person-vision.check.mjs <person-reference-image> <camera-person-photo>
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const [referencePath, photoPath] = process.argv.slice(2)
if (!referencePath || !photoPath) throw new Error('Provide a person reference image and a camera person photo.')
const root = fileURLToPath(new URL('../', import.meta.url))
const out = await mkdtemp(path.join(tmpdir(), 'forest-person-vision-'))
const entry = path.join(root, `.forest-person-vision-${process.pid}.ts`)
let browser
try {
  await writeFile(entry, `
import { buildResident } from './src/forest-resident-model'
const worker = new Worker('worker.js', {type:'module'})
let resolveReady, rejectReady, resolveAnalysis, rejectAnalysis
const ready = new Promise((resolve,reject)=>{ resolveReady=resolve; rejectReady=reject })
worker.onmessage=({data})=>{
 if(data.type==='ready') resolveReady()
 if(data.type==='error') { const error=new Error(data.message); rejectReady(error); rejectAnalysis?.(error) }
 if(data.type==='result') resolveAnalysis(data.analysis)
}
worker.onerror=event=>{ const error=new Error(event.message); rejectReady(error); rejectAnalysis?.(error) }
worker.postMessage({type:'init',base:${JSON.stringify(pathToFileURL(path.join(root, 'public/')).href)}})
async function imageCanvas(url,maxSize) {
 const img=new Image();img.src=url;await img.decode()
 const scale=Math.min(1,maxSize/Math.max(img.naturalWidth,img.naturalHeight))
 const canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale)
 canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return canvas
}
window.run=async()=>{
 await ready
 const reference=await imageCanvas(${JSON.stringify(pathToFileURL(path.resolve(referencePath)).href)},640)
 const photo=await imageCanvas(${JSON.stringify(pathToFileURL(path.resolve(photoPath)).href)},1024)
 const response=new Promise((resolve,reject)=>{resolveAnalysis=resolve;rejectAnalysis=reject})
 const a=await createImageBitmap(reference),b=await createImageBitmap(photo)
 worker.postMessage({type:'analyze',reference:a,photo:b,focus:{x:.5,y:.5}},[a,b])
 const analysis=await response;const model=buildResident(photo,analysis)
 const sources=[];model.group.traverse(o=>{if(o.isMesh)sources.push(o.material.map?.userData.residentTextureSource??'solid')})
 const result={kind:model.group.userData.kind,sources,posePoints:analysis.referencePose.length,
  foreground:analysis.reference.values.reduce((n,v)=>n+(v>127?1:0),0)/analysis.reference.values.length,
  person:analysis.person.values.reduce((n,v)=>n+(v>127?1:0),0)/analysis.person.values.length}
 model.dispose();return result
}
`)
  const baseBuild = { root, configFile: false, publicDir: false, logLevel: 'error' }
  await build({ ...baseBuild, build: { outDir: out, emptyOutDir: true, lib: { entry, name: 'PersonVisionCheck', formats: ['iife'], fileName: () => 'main.js' } } })
  await build({ ...baseBuild, build: { outDir: out, emptyOutDir: false, lib: { entry: path.join(root, 'src/forest-resident.worker.ts'), name: 'ResidentWorker', formats: ['iife'], fileName: () => 'worker.js' } } })
  // Browser fetch cannot read model file URLs. Serve bytes from memory inside
  // the test worker; run the actual production worker/model code unchanged.
  const assets = {}
  for (const name of ['wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm', 'wasm/vision_wasm_nosimd_internal.js', 'wasm/vision_wasm_nosimd_internal.wasm', 'magic_touch.tflite', 'selfie_segmenter.tflite', 'pose_landmarker_lite.task', 'efficientnet_lite0.tflite']) {
    assets[name] = 'data:application/octet-stream;base64,' + (await readFile(path.join(root, 'public/mediapipe', name))).toString('base64')
  }
  const script = await readFile(path.join(out, 'worker.js'), 'utf8')
  await writeFile(path.join(out, 'worker.js'), `const testAssets=${JSON.stringify(assets)};const originalFetch=self.fetch.bind(self);self.fetch=(url,options)=>{const key=Object.keys(testAssets).find(k=>String(url).endsWith(k));return originalFetch(key?testAssets[key]:url,options)};` + script)
  await writeFile(path.join(out, 'index.html'), '<meta charset="utf-8"><script src="main.js"></script>')
  browser = await chromium.launch({ args: ['--allow-file-access-from-files'] })
  const page = await browser.newPage(); const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (/Aborted|Check failed|memory access|\[forest-resident\]/i.test(message.text())) errors.push(message.text()) })
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href)
  // Reusing the worker must turn camera mask output back on after reference
  // landmark-only analysis, without reintroducing the portrait mask crash.
  const results = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await page.evaluate(() => Promise.race([window.run(), new Promise((_, reject) => setTimeout(() => reject(new Error('Vision check timed out')), 90000))]))
    assert.equal(result.kind, 'person'); assert.equal(result.posePoints, 33)
    assert.ok(result.foreground > .01 && result.foreground < .9); assert.ok(result.person > .01)
    assert.equal(result.sources.filter(source => source === 'camera-face').length, 1)
    assert.ok(result.sources.includes('wardrobe')); results.push(result)
  }
  assert.equal(results[0].person, results[1].person); assert.deepEqual(errors, [])
  console.log('PASS: real reference → person model, face-only camera texture, generated outfit, repeated worker analysis.', results)
} finally {
  await browser?.close(); await unlink(entry).catch(() => {}); await rm(out, { recursive: true, force: true })
}
