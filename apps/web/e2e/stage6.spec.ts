import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

async function completeOrderRolls(page: Page) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const confirm = page.getByRole('button', { name: '选择起始道具' })
    if (await confirm.isVisible()) {
      await confirm.click()
      return
    }
    const roll = page.getByRole('button', { name: '投掷单骰' })
    if (await roll.count() > 0 && await roll.isEnabled()) await roll.click()
    else await page.waitForTimeout(30)
  }
  throw new Error('Turn-order rolls did not finish.')
}

async function completeStartingItemChoices(page: Page) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const roll = page.getByRole('button', { name: '投掷双骰' })
    if (await roll.isEnabled()) return
    const confirm = page.getByRole('button', { name: '确认选择' })
    if (await confirm.isVisible() && await confirm.isEnabled()) await confirm.click()
    else await page.waitForTimeout(30)
  }
  throw new Error('Starting item choices did not finish.')
}

async function startGame(page: Page, mode = '1v1', seed = 3, speed = 1) {
  await page.goto(`/play?mode=${mode}&seed=${seed}&speed=${speed}`)
  await expect(page.getByRole('heading', { name: '投掷单骰决定顺序' })).toBeVisible()
  await expect(page.locator('canvas[data-testid="pixi-canvas"]')).toHaveCount(1)
  await page.getByRole('radio', { name: '黄鹅' }).click()
  await completeOrderRolls(page)
  await completeStartingItemChoices(page)
  await expect(page.getByRole('button', { name: '投掷双骰' })).toBeEnabled()
}

async function canvasPixelStats(page: Page) {
  const buffer = await page.locator('canvas[data-testid="pixi-canvas"]').screenshot()
  const image = PNG.sync.read(buffer)
  let opaque = 0
  let varied = 0
  const first = [image.data[0], image.data[1], image.data[2]]
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] > 0) opaque += 1
    if (Math.abs(image.data[index] - first[0]) + Math.abs(image.data[index + 1] - first[1]) + Math.abs(image.data[index + 2] - first[2]) > 18) varied += 1
  }
  return { opaque, varied }
}

async function threeCanvasVisiblePixels(page: Page, region: 'center' | 'bottom') {
  return page.locator('canvas[data-testid="three-dice-canvas"]').evaluate((element, targetRegion) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!context) return 0
    const x = Math.floor(context.drawingBufferWidth * 0.34)
    const width = Math.floor(context.drawingBufferWidth * 0.32)
    const y = targetRegion === 'center'
      ? Math.floor(context.drawingBufferHeight * 0.3)
      : 0
    const height = targetRegion === 'center'
      ? Math.floor(context.drawingBufferHeight * 0.4)
      : Math.min(context.drawingBufferHeight, Math.floor(170 * window.devicePixelRatio))
    const pixels = new Uint8Array(width * height * 4)
    context.readPixels(x, y, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels)
    let visible = 0
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 20) visible += 1
    }
    return visible
  }, region)
}

async function threeCanvasCenterSignature(page: Page) {
  return page.locator('canvas[data-testid="three-dice-canvas"]').evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!context) return { hash: 0, visible: 0 }
    const x = Math.floor(context.drawingBufferWidth * 0.34)
    const y = Math.floor(context.drawingBufferHeight * 0.3)
    const width = Math.floor(context.drawingBufferWidth * 0.32)
    const height = Math.floor(context.drawingBufferHeight * 0.4)
    const pixels = new Uint8Array(width * height * 4)
    context.readPixels(x, y, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels)
    let hash = 2_166_136_261
    let visible = 0
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index + 3] > 20) visible += 4
      hash = Math.imul(hash ^ pixels[index], 16_777_619)
      hash = Math.imul(hash ^ pixels[index + 1], 16_777_619)
      hash = Math.imul(hash ^ pixels[index + 2], 16_777_619)
      hash = Math.imul(hash ^ pixels[index + 3], 16_777_619)
    }
    return { hash: hash >>> 0, visible }
  })
}

test('renders a nonblank complete board at all desktop targets', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport)
    await startGame(page, '1v3', 3)
    const canvas = page.locator('canvas[data-testid="pixi-canvas"]')
    const bounds = await canvas.boundingBox()
    expect(bounds?.width).toBe(viewport.width)
    expect(bounds?.height).toBe(viewport.height - 68)
    const pixels = await canvasPixelStats(page)
    const canvasArea = (bounds?.width ?? 0) * (bounds?.height ?? 0)
    expect(pixels.opaque).toBeGreaterThan(canvasArea * 0.95)
    expect(pixels.varied).toBeGreaterThan(canvasArea * 0.2)
    await page.screenshot({ path: testInfo.outputPath(`stage6-${viewport.width}x${viewport.height}.png`), fullPage: true })
  }
})

test('plays route states in order before opening an event', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await startGame(page, '1v1', 3)
  await page.evaluate(() => {
    const target = document.querySelector('.round-float span')
    ;(window as typeof window & { __stage6States?: string[] }).__stage6States = target?.textContent ? [target.textContent] : []
    if (target) new MutationObserver(() => {
      const text = target.textContent
      if (text) (window as typeof window & { __stage6States?: string[] }).__stage6States?.push(text)
    }).observe(target, { childList: true, subtree: true, characterData: true })
  })
  await expect(page.locator('.dice-readout')).toHaveCount(0)
  await page.getByRole('button', { name: '投掷双骰' }).click()
  await expect(page.locator('.round-float span')).toHaveText('骰子滚动')
  await expect(page.locator('.dice-readout')).toHaveText(/^\d+$/)
  await expect(page.locator('.dice-readout')).not.toContainText(/[+=]/)
  await expect(page.getByRole('heading', { name: '从三张牌中选择' })).toBeVisible()
  await expect(page.locator('.round-float span')).toHaveText('等待行动')
  await expect(page.locator('.dice-readout')).toHaveCount(0)
  await expect(page.locator('.held-item')).toHaveCSS('opacity', '1')
  expect(await threeCanvasVisiblePixels(page, 'center')).toBe(0)
  expect(await threeCanvasVisiblePixels(page, 'bottom')).toBe(0)
  const states = await page.evaluate(() => (window as typeof window & { __stage6States?: string[] }).__stage6States ?? [])
  const expected = ['骰子滚动', '路线预览', '目标锁定', '路线收起', '棋子移动', '等待行动']
  let cursor = -1
  for (const state of expected) {
    const next = states.indexOf(state, cursor + 1)
    expect(next, `${state} missing from ${states.join(' > ')}`).toBeGreaterThan(cursor)
    cursor = next
  }
})

test('docks clickable 3D dice, rolls them at board center, and settles the authority result', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport)
    await startGame(page, '1v1', 3, 0.75)
    const trigger = page.getByRole('button', { name: '投掷双骰' })
    const triggerBounds = await trigger.boundingBox()
    expect(Math.abs((triggerBounds?.x ?? 0) + (triggerBounds?.width ?? 0) / 2 - viewport.width / 2)).toBeLessThan(2)
    expect((triggerBounds?.y ?? 0) + (triggerBounds?.height ?? 0)).toBeGreaterThan(viewport.height - 30)
    await expect(page.locator('canvas[data-testid="three-dice-canvas"]')).toHaveCount(1)
    expect(await threeCanvasVisiblePixels(page, 'bottom')).toBeGreaterThan(1_000)
    await page.screenshot({ path: testInfo.outputPath(`dice-docked-${viewport.width}x${viewport.height}.png`), fullPage: true })
    await page.evaluate(() => {
      const target = document.querySelector('.three-dice-layer')
      const state = window as typeof window & { __diceResultClasses?: string[] }
      state.__diceResultClasses = []
      if (target) new MutationObserver(() => {
        const result = document.querySelector('.dice-result')
        if (result) state.__diceResultClasses?.push(result.className)
      }).observe(target, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true })
    })
    const centeredReady = page.evaluate(() => new Promise<number>((resolve) => {
      const target = document.querySelector('.three-dice-layer')
      const visibleCenterPixels = () => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-testid="three-dice-canvas"]')
        const context = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
        if (!context) return 0
        const x = Math.floor(context.drawingBufferWidth * 0.34)
        const y = Math.floor(context.drawingBufferHeight * 0.3)
        const width = Math.floor(context.drawingBufferWidth * 0.32)
        const height = Math.floor(context.drawingBufferHeight * 0.4)
        const pixels = new Uint8Array(width * height * 4)
        context.readPixels(x, y, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels)
        let visible = 0
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 20) visible += 1
        return visible
      }
      const resolveWhenCentered = () => {
        if (document.querySelector('.dice-result.is-centered')) {
          observer.disconnect()
          resolve(visibleCenterPixels())
        }
      }
      const observer = new MutationObserver(resolveWhenCentered)
      if (target) observer.observe(target, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true })
      resolveWhenCentered()
    }))

    await trigger.click()
    await expect(page.locator('.three-dice-layer')).toHaveClass(/is-rolling/)
    await expect.poll(() => threeCanvasVisiblePixels(page, 'center')).toBeGreaterThan(1_000)
    expect(await centeredReady).toBeGreaterThan(1_000)
    const result = page.locator('.dice-readout')
    const centeredPresentation = await result.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        centered: element.classList.contains('is-centered'),
        fontSize: style.fontSize,
        height: style.height,
        width: style.width,
        zIndex: style.zIndex,
      }
    })
    expect(centeredPresentation).toEqual({ centered: true, fontSize: '216px', height: '280px', width: '280px', zIndex: '5' })
    await page.screenshot({ path: testInfo.outputPath(`dice-result-centered-${viewport.width}x${viewport.height}.png`), fullPage: true })
    await expect(result).toHaveText(/^([2-9]|1[0-2])$/)
    await expect(result).toHaveAttribute('aria-label', /骰子结果 ([2-9]|1[0-2])$/)
    await expect(result).toHaveClass(/is-corner/)
    const expectedResultX = viewport.width / 2 + Math.min(viewport.width / 2 - 152, 515)
    const flight = await result.evaluate((element) => {
      const animation = element.getAnimations().find((candidate) => (
        candidate instanceof CSSAnimation && candidate.animationName === 'dice-result-flight'
      ))
      const timing = animation?.effect?.getComputedTiming()
      const playState = animation?.playState ?? 'missing'
      if (animation && typeof timing?.duration === 'number') {
        animation.pause()
        animation.currentTime = timing.duration * 0.38
      }
      return { duration: timing?.duration ?? 0, playState }
    })
    expect(flight.duration).toBeGreaterThanOrEqual(1_500)
    expect(['running', 'finished']).toContain(flight.playState)
    const inFlightBounds = await result.boundingBox()
    const inFlightX = (inFlightBounds?.x ?? 0) + (inFlightBounds?.width ?? 0) / 2
    expect(inFlightX).toBeGreaterThan(viewport.width / 2 + 20)
    expect(inFlightX).toBeLessThan(expectedResultX - 5)
    await expect(page.locator('.held-item')).toHaveCSS('opacity', '0')
    await page.screenshot({ path: testInfo.outputPath(`dice-result-flight-${viewport.width}x${viewport.height}.png`), fullPage: true })
    const resultClasses = await page.evaluate(() => (window as typeof window & { __diceResultClasses?: string[] }).__diceResultClasses ?? [])
    expect(resultClasses.some((className) => className.includes('is-centered'))).toBe(true)
    expect(resultClasses.some((className) => className.includes('is-corner'))).toBe(true)
    expect(await threeCanvasVisiblePixels(page, 'center')).toBe(0)
  }
})

test('keeps the 1x dice result readable when reduced motion is enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1600, height: 900 })
  await startGame(page, '1v1', 3, 1)
  await page.evaluate(() => {
    const target = document.querySelector('.three-dice-layer')
    const state = window as typeof window & { __reducedDiceResultClasses?: string[] }
    state.__reducedDiceResultClasses = []
    if (target) new MutationObserver(() => {
      const result = document.querySelector('.dice-result')
      if (result) state.__reducedDiceResultClasses?.push(result.className)
    }).observe(target, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true })
  })
  const startedAt = Date.now()
  await page.getByRole('button', { name: '投掷双骰' }).click()
  const result = page.locator('.dice-readout')
  await expect(result).toBeVisible()
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_600)
  await expect(result).toHaveClass(/is-corner/)
  const resultClasses = await page.evaluate(() => (
    window as typeof window & { __reducedDiceResultClasses?: string[] }
  ).__reducedDiceResultClasses ?? [])
  expect(resultClasses.some((className) => className.includes('is-centered'))).toBe(true)
  const flight = await result.evaluate((element) => {
    const animation = element.getAnimations().find((candidate) => candidate instanceof CSSAnimation)
    return {
      duration: animation?.effect?.getComputedTiming().duration ?? 0,
      name: animation instanceof CSSAnimation ? animation.animationName : 'missing',
    }
  })
  expect(flight.name).toBe('dice-result-flight-reduced')
  expect(flight.duration).toBeGreaterThanOrEqual(900)
})

test('reveals the standard 1x result on the 2.4 second dice timeline', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await startGame(page, '1v1', 3, 1)
  await page.evaluate(() => {
    const layer = document.querySelector('.three-dice-layer')
    const trigger = document.querySelector<HTMLButtonElement>('.three-dice-trigger')
    const state = window as typeof window & { __standardDiceTiming?: { startedAt: number; settledAt: number } }
    state.__standardDiceTiming = { startedAt: 0, settledAt: 0 }
    trigger?.addEventListener('click', () => {
      if (state.__standardDiceTiming) state.__standardDiceTiming.startedAt = performance.now()
    }, { once: true })
    if (layer) new MutationObserver(() => {
      if (layer.classList.contains('is-settled') && state.__standardDiceTiming && !state.__standardDiceTiming.settledAt) {
        state.__standardDiceTiming.settledAt = performance.now()
      }
    }).observe(layer, { attributes: true, attributeFilter: ['class'] })
  })
  await page.getByRole('button', { name: '投掷双骰' }).click()
  await page.waitForTimeout(700)
  const earlyCenterFrame = await threeCanvasCenterSignature(page)
  expect(earlyCenterFrame.visible).toBeGreaterThan(1_000)
  await page.waitForTimeout(400)
  const continuingCenterFrame = await threeCanvasCenterSignature(page)
  expect(continuingCenterFrame.visible).toBeGreaterThan(1_000)
  expect(continuingCenterFrame.hash).not.toBe(earlyCenterFrame.hash)
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __standardDiceTiming?: { settledAt: number } }
  ).__standardDiceTiming?.settledAt ?? 0)).toBeGreaterThan(0)
  const elapsed = await page.evaluate(() => {
    const timing = (window as typeof window & {
      __standardDiceTiming?: { startedAt: number; settledAt: number }
    }).__standardDiceTiming
    return timing ? timing.settledAt - timing.startedAt : 0
  })
  expect(elapsed).toBeGreaterThanOrEqual(1_600)
  expect(elapsed).toBeLessThan(2_300)
})

test('resolves a dice-check event and shows its outcome', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await startGame(page, '1v1', 3)
  await page.getByRole('button', { name: '投掷双骰' }).click()
  await expect(page.getByRole('heading', { name: '从三张牌中选择' })).toBeVisible()

  const diceCheck = page.locator('.event-choice').filter({ hasText: '双骰 ≥' }).first()
  await expect(diceCheck).toBeVisible()
  const eventTitle = await diceCheck.locator('strong').textContent()
  await diceCheck.click()

  await expect(page.locator('.outcome-panel')).toBeVisible()
  await expect(page.locator('.outcome-panel h2')).toHaveText(eventTitle ?? '')
  await expect(page.locator('.outcome-mark')).toHaveCount(1)
  await page.getByRole('button', { name: '继续' }).click()
  await expect(page.locator('.outcome-panel')).toHaveCount(0)
})

test('fast-forwards presentation to the authority snapshot after focus loss', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await startGame(page, '1v1', 3)
  await page.getByRole('button', { name: '投掷双骰' }).click()
  await expect(page.locator('.round-float span')).toHaveText('骰子滚动')

  await page.evaluate(() => window.dispatchEvent(new Event('blur')))

  await expect(page.getByRole('heading', { name: '从三张牌中选择' })).toBeVisible({ timeout: 2_000 })
  await expect(page.locator('.round-float span')).toHaveText('等待行动')
})

test('recreates and disposes the Pixi application twenty times', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/play?mode=1v2&seed=19')
  for (let iteration = 0; iteration < 20; iteration += 1) {
    await expect(page.locator('canvas[data-testid="pixi-canvas"]')).toHaveCount(1)
    await page.getByRole('button', { name: '重新开始' }).evaluate((button: HTMLButtonElement) => button.click())
    await expect(page.locator('canvas[data-testid="pixi-canvas"]')).toHaveCount(1)
    await expect(page.getByRole('heading', { name: '投掷单骰决定顺序' })).toBeVisible()
  }
  expect(await page.locator('canvas[data-testid="pixi-canvas"]').count()).toBe(1)
})

for (const [mode, seed] of [['1v1', 41], ['1v2', 73], ['1v3', 109]] as const) {
  test(`completes a deterministic ${mode} match on winning spaces 63-65`, async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1280, height: 720 })
    await startGame(page, mode, seed, 20)

    for (let step = 0; step < 240; step += 1) {
      const winHeading = page.locator('.win-panel h2')
      if (await winHeading.isVisible()) {
        await expect(page.locator('.win-summary > p')).toContainText(/进入第 (63|64|65) 格/)
        await expect(page.locator('.final-ranking li')).toHaveCount(Number(mode.at(-1)) + 1)
        await page.screenshot({ path: testInfo.outputPath(`stage6-finish-${mode}.png`), fullPage: true })
        return
      }
      const outcomeContinue = page.getByRole('button', { name: '继续' })
      const eventChoice = page.locator('.event-choice').first()
      const itemChoice = page.locator('.item-compare-grid button').last()
      const itemConfirm = page.getByRole('button', { name: '确认保留' })
      const roll = page.getByRole('button', { name: '投掷双骰' })
      if (await outcomeContinue.isVisible()) await outcomeContinue.click()
      else if (await eventChoice.isVisible()) await eventChoice.click()
      else if (await itemChoice.isVisible()) { await itemChoice.click(); await itemConfirm.click() }
      else if (await roll.isEnabled()) await roll.click()
      else await page.waitForTimeout(30)
    }
    throw new Error(`${mode} did not reach a winner within the interaction limit.`)
  })
}
