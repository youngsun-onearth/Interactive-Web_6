// Run directly with node. Builds static files and opens file://; never starts a server.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const output = await mkdtemp(path.join(tmpdir(), 'space-edition-check-'))
await build({ configFile: false, base: './', logLevel: 'error', plugins: [{
  name: 'space-check-inspection', enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('/forest-edition/animal-edition.ts')) return code.replace('return {\n    start()', 'Object.assign(window, { __space: { THREE, world, scene, camera, renderer, controls, ground, wildlife, space } });\n  return {\n    start()')
  },
}], build: { outDir: output, emptyOutDir: true } })
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--allow-file-access-from-files'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error' && /THREE|WebGL|shader/i.test(message.text())) errors.push(message.text()) })
const panel = page.locator('[data-example-panel="animal-forest-edition"]')
try {
  await page.goto(`${pathToFileURL(path.join(output, 'index.html')).href}#animal-forest-edition`)
  await page.waitForFunction(() => !!window.__space)
  await page.waitForTimeout(350)
  assert.equal(await panel.getAttribute('data-species'), '16')
  await page.screenshot({ path: path.join(output, 'space-globe.png') })
  const environment = await page.evaluate(() => {
    const { space, world, scene } = window.__space
    const clouds = world.getObjectByName('행성을 감싸는 구름'), cloudStart = clouds.children[0].position.clone()
    const asteroid = scene.getObjectByName('지나가는 소행성'), asteroidStart = asteroid.position.clone()
    space.resetClock()
    for (let i = 0; i < 800; i++) space.update(1000 + i * 40, false, false)
    return { clouds: clouds.children.length, cloudMoved: clouds.children[0].position.distanceTo(cloudStart), asteroidMoved: asteroid.position.distanceTo(asteroidStart), meteors: space.meteorCount }
  })
  assert(environment.clouds >= 8 && environment.cloudMoved > .5)
  assert(environment.asteroidMoved > 1 && environment.meteors >= 5)
  console.log('Environment:', environment)

  async function animalPoint(species, frame = false) {
    return page.evaluate(({ species, frame }) => {
      const { THREE, wildlife, camera, controls, world, renderer } = window.__space
      const animal = wildlife.animals.find(a => a.species === species)
      const normal = animal.direction.clone().applyQuaternion(world.getWorldQuaternion(new THREE.Quaternion()))
      if (frame) { camera.position.copy(normal).multiplyScalar(15); camera.up.set(0, 1, 0); controls.target.set(0, 0, 0); controls.update() }
      world.updateMatrixWorld(true); camera.updateMatrixWorld()
      const center = new THREE.Box3().setFromObject(animal.anchor).getCenter(new THREE.Vector3()).project(camera)
      const rect = renderer.domElement.getBoundingClientRect()
      return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 }
    }, { species, frame })
  }
  for (const [species, cry] of [['siamese', /야옹|냐아|그르릉/], ['shark', /보글|첨벙/]]) {
    const point = await animalPoint(species, true)
    await page.mouse.click(point.x, point.y)
    await page.waitForFunction(s => document.querySelector('.space-edition')?.dataset.followingAnimal === s, species)
    await page.waitForTimeout(800)
    await panel.evaluate(element => {
      if (element.dataset.dialogueState !== 'complete') element.querySelector('.edition-forest-dialogue').click()
    })
    assert.match(await panel.locator('.edition-forest-dialogue__text').textContent(), cry)
    assert.equal(await panel.getAttribute('data-camera-mode'), 'follow')
    const before = await page.evaluate(() => window.__space.camera.position.toArray())
    await page.mouse.move(900, 440); await page.mouse.down(); await page.mouse.move(1030, 475, { steps: 8 }); await page.mouse.up()
    await page.waitForTimeout(450)
    const after = await page.evaluate(() => window.__space.camera.position.toArray())
    assert(Math.hypot(...after.map((v, i) => v - before[i])) > .1)
    const distanceBefore = await page.evaluate(() => window.__space.camera.position.distanceTo(window.__space.controls.target))
    await page.mouse.wheel(0, -200)
    await page.waitForTimeout(450)
    const distanceAfter = await page.evaluate(() => window.__space.camera.position.distanceTo(window.__space.controls.target))
    assert(distanceAfter < distanceBefore, 'wheel zoom moves the tracking camera closer')
    await page.screenshot({ path: path.join(output, `space-follow-${species}.png`) })
    const again = await animalPoint(species)
    await page.mouse.click(again.x, again.y)
    await page.waitForFunction(() => document.querySelector('.space-edition')?.dataset.cameraMode === 'globe')
    assert(await panel.locator('.edition-forest-dialogue').isHidden())
    await page.waitForTimeout(1400)
    console.log('Click, voice, orbit, zoom, click-to-return:', species)
  }
  await panel.locator('.edition-forest-move-in').click()
  await page.locator('.space-studio[open]').waitFor()
  assert.match(await page.locator('.space-studio h2').textContent(), /행성/)
  await page.locator('.edition-forest-studio__close').click()
  await page.locator('.example-button[data-example="animal-forest-extended"]').click()
  await page.locator('[data-example-panel="animal-forest-extended"] canvas').waitFor()
  assert.match(await page.locator('[data-example-panel="animal-forest-extended"] h2').textContent(), /확장판/)
  await page.locator('.example-button[data-example="animal-forest-edition"]').click()
  assert(await panel.isVisible())
  assert.deepEqual(errors, [])
  console.log('PASS. Screenshots:', output)
} finally { await browser.close() }
