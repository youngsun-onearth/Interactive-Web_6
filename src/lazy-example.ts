type ExampleController = {
  start: () => void
  stop: () => void
  captureFrame: () => HTMLCanvasElement
  setPaused?: (paused: boolean) => void
  setCapturing?: (capturing: boolean) => void
}

// Preserve each example's controller and visuals, but do not allocate its
// canvases, listeners or models until it is selected for the first time.
export function createLazyExample(
  panel: HTMLElement,
  load: () => Promise<(panel: HTMLElement) => ExampleController>,
  isSelected: () => boolean,
) {
  let controller: ExampleController | null = null
  let loading: Promise<void> | null = null
  let wanted = false, paused = false, capturing = false
  function activate() {
    if (!controller || !wanted || !isSelected()) return
    controller.start()
    controller.setCapturing?.(capturing)
    if (paused) controller.setPaused?.(true)
  }
  return {
    start() {
      wanted = true
      if (controller) { activate(); return }
      if (loading) return
      panel.setAttribute('aria-busy', 'true')
      loading = load().then(factory => {
        controller = factory(panel)
        activate()
      }).catch(error => {
        console.error('Unable to load example:', error)
        if (wanted && isSelected()) panel.textContent = '예제를 불러오지 못했어요. 다른 예제를 선택한 뒤 다시 열어 주세요.'
      }).finally(() => { loading = null; panel.removeAttribute('aria-busy') })
    },
    stop() { wanted = false; paused = false; controller?.stop() },
    captureFrame() { return controller?.captureFrame() ?? null },
    setPaused(value: boolean) { paused = value; controller?.setPaused?.(value) },
    setCapturing(value: boolean) { capturing = value; controller?.setCapturing?.(value) },
  }
}
