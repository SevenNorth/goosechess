import { expect, test, type Page } from '@playwright/test'

async function waitForBoard(page: Page) {
  await expect(page.locator('canvas[data-testid="pixi-canvas"]')).toHaveCount(1)
  await expect(page.getByText('正在铺设奥普港棋盘')).toHaveCount(0)
}

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

async function completeStartingItemChoices(page: Page, preferredItem?: RegExp) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const roll = page.getByRole('button', { name: '投掷双骰' })
    if (await roll.isEnabled()) return
    const confirm = page.getByRole('button', { name: '确认选择' })
    if (await confirm.isVisible()) {
      if (preferredItem) {
        const preferred = page.getByRole('radio', { name: preferredItem })
        if (await preferred.isVisible()) await preferred.click()
      }
      if (await confirm.isEnabled()) await confirm.click()
    } else await page.waitForTimeout(30)
  }
  throw new Error('Starting item choices did not finish.')
}

async function startGame(page: Page, mode = '1v1', seed = 3, speed = 20, preferredItem?: RegExp) {
  await page.goto(`/play?mode=${mode}&seed=${seed}&speed=${speed}`)
  await waitForBoard(page)
  await completeOrderRolls(page)
  await completeStartingItemChoices(page, preferredItem)
  await expect(page.getByRole('button', { name: '投掷双骰' })).toBeEnabled()
}

async function driveUntilFinished(page: Page) {
  for (let step = 0; step < 260; step += 1) {
    if (await page.locator('.win-panel h2').isVisible()) return
    const outcomeContinue = page.getByRole('button', { name: '继续' })
    const eventChoice = page.locator('.event-choice').first()
    const itemChoice = page.locator('.item-compare-grid button').last()
    const itemConfirm = page.getByRole('button', { name: '确认保留' })
    const roll = page.getByRole('button', { name: '投掷双骰' })
    if (await outcomeContinue.isVisible()) await outcomeContinue.click()
    else if (await eventChoice.isVisible()) await eventChoice.click()
    else if (await itemChoice.isVisible()) {
      await itemChoice.click()
      await itemConfirm.click()
    }
    else if (await roll.isEnabled()) await roll.click()
    else await page.waitForTimeout(25)
  }
  throw new Error('Fixed-seed match did not finish within the interaction limit.')
}

async function measureFps(page: Page) {
  const result = await page.evaluate(() => new Promise<{ frames: number; elapsed: number }>((resolve) => {
    let frames = 0
    const started = performance.now()
    const frame = (now: number) => {
      frames += 1
      if (now - started >= 1500) resolve({ frames, elapsed: now - started })
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }))
  return result.frames / result.elapsed * 1000
}

test('shows load progress and recovers from a failed board resource', async ({ page }) => {
  let allowResource = false
  await page.route('**/assets/maps/aup-port/yellow-dog.png', async (route) => {
    if (allowResource) await route.continue()
    else await route.abort('failed')
  })
  await page.goto('/play?mode=1v1&seed=7')
  await expect(page.getByText('正在铺设奥普港棋盘')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('棋盘资源加载失败')
  allowResource = true
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.locator('canvas[data-testid="pixi-canvas"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '投掷单骰' })).toBeEnabled()
})

test('starts every offline mode with mouse controls only', async ({ page }) => {
  for (const mode of ['1v1', '1v2', '1v3'] as const) {
    await startGame(page, mode, 31)
    await expect(page.getByRole('region', { name: '参赛棋手' }).getByRole('article')).toHaveCount(Number(mode.at(-1)) + 1)
    await page.getByRole('button', { name: '投掷双骰' }).click()
  }
})

test('lists the in-game player HUD in final action order', async ({ page }) => {
  await page.goto('/play?mode=1v3&seed=17&speed=20')
  await waitForBoard(page)
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const confirm = page.getByRole('button', { name: '选择起始道具' })
    if (await confirm.isVisible()) break
    const roll = page.getByRole('button', { name: '投掷单骰' })
    if (await roll.count() > 0 && await roll.isEnabled()) await roll.click()
    else await page.waitForTimeout(30)
  }
  const orderNames = await page.locator('.order-player strong').allTextContents()
  expect(orderNames).toHaveLength(4)
  await page.getByRole('button', { name: '选择起始道具' }).click()
  await completeStartingItemChoices(page)
  await expect(page.getByRole('button', { name: '投掷双骰' })).toBeEnabled()
  await expect(page.locator('.hud-player-copy > div:first-child > strong')).toHaveText(orderNames)
})

test('returns from a selected match to the preparation page', async ({ page }) => {
  await page.goto('/play?mode=1v2&seed=31')
  await waitForBoard(page)

  await page.getByRole('button', { name: '返回首页' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: '选择人机模式' })).toBeVisible()
})

test('keeps a full desktop board fixed at its native scale', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await startGame(page, '1v1', 31)
  const before = await page.evaluate(() => window.__GOOSE_CHESS_DIAGNOSTICS__?.())

  expect(before?.pannable).toBe(false)
  expect(before?.cameraZoom).toBe(1)
  await page.getByRole('button', { name: '投掷双骰' }).click()
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => window.__GOOSE_CHESS_DIAGNOSTICS__?.())

  expect(after?.cameraZoom).toBe(1)
  expect(after?.cameraFocusX).toBe(before?.cameraFocusX)
  expect(after?.cameraFocusY).toBe(before?.cameraFocusY)
})

test('allows dragging a board that does not fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await startGame(page, '1v1', 31)
  const canvas = page.locator('canvas[data-testid="pixi-canvas"]')
  const before = await page.evaluate(() => window.__GOOSE_CHESS_DIAGNOSTICS__?.())
  const box = await canvas.boundingBox()

  expect(before?.pannable).toBe(true)
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 - 120, box!.y + box!.height / 2 - 80, { steps: 6 })
  await page.mouse.up()
  const after = await page.evaluate(() => window.__GOOSE_CHESS_DIAGNOSTICS__?.())

  expect(after?.cameraFocusX !== before?.cameraFocusX || after?.cameraFocusY !== before?.cameraFocusY).toBe(true)
})

test('offers animation speed and camera motion settings', async ({ page }) => {
  await startGame(page)
  const settingsButton = page.getByRole('button', { name: '表现设置' })
  await expect(settingsButton).toHaveAttribute('title', '表现设置')
  await settingsButton.click()
  const dialog = page.getByRole('dialog', { name: '表现设置' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: '1.5x' }).click()
  await expect(dialog.getByRole('radio', { name: '1.5x' })).toHaveAttribute('aria-checked', 'true')
  const camera = dialog.getByRole('checkbox')
  await expect(camera).toBeChecked()
  await camera.uncheck()
  await expect(camera).not.toBeChecked()
})

test('confirms item use in the center and highlights the retained item', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await startGame(page, '1v1', 242, 20, /轻便靴子/)
  await page.locator('.held-item').click()
  const useDialog = page.getByRole('dialog', { name: '使用轻便靴子' })
  await expect(useDialog).toBeVisible()
  const dialogBox = await useDialog.boundingBox()

  expect(dialogBox).not.toBeNull()
  expect(Math.abs(dialogBox!.x + dialogBox!.width / 2 - 960)).toBeLessThan(2)
  await useDialog.getByRole('button', { name: '取消' }).click()
  await page.getByRole('button', { name: '投掷双骰' }).click()
  await page.getByRole('button', { name: /走失的猫/ }).click()
  await page.getByRole('button', { name: '继续' }).click()

  const itemDialog = page.getByRole('dialog', { name: '选择保留的道具' })
  const currentItem = itemDialog.getByRole('radio', { name: /当前/ })
  const newItem = itemDialog.getByRole('radio', { name: /新道具/ })
  await expect(currentItem).toHaveAttribute('aria-checked', 'true')
  await expect(currentItem).toHaveClass(/is-selected/)
  await newItem.click()
  await expect(currentItem).toHaveAttribute('aria-checked', 'false')
  await expect(newItem).toHaveAttribute('aria-checked', 'true')
  await expect(newItem).toHaveClass(/is-selected/)
  await itemDialog.getByRole('button', { name: '确认保留' }).click()
  await expect(itemDialog).toHaveCount(0)
})

test('keeps opponent items private and tears a used item card vertically', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1600, height: 900 })
  await startGame(page, '1v1', 12, 1, /轻便靴子/)

  const opponents = page.locator('.hud-player').filter({ hasText: '电脑' })
  await expect(opponents).toHaveCount(1)
  await expect(opponents.locator('.hud-player-copy > small')).toHaveCount(0)
  await expect(opponents).not.toContainText(/轻便靴子|四叶草|漂流木盾/)

  await page.locator('.held-item').click()
  await page.getByRole('dialog', { name: '使用轻便靴子' }).getByRole('button', { name: '确认使用' }).click()
  const usePresentation = page.getByRole('status', { name: '玩家使用轻便靴子' })
  await expect(usePresentation).toBeVisible()
  await expect(usePresentation.locator('.item-use-flight')).toHaveClass(/is-local/)
  await expect(usePresentation).toContainText('玩家')
  await expect(usePresentation).toContainText('使用了主动道具')

  const tear = await usePresentation.evaluate((element) => {
    const animations = element.getAnimations({ subtree: true })
    for (const animation of animations) {
      const duration = animation.effect?.getComputedTiming().duration
      if (typeof duration === 'number') animation.currentTime = duration * 0.72
      animation.pause()
    }
    const left = getComputedStyle(element.querySelector('.item-use-card-half.is-left')!)
    const right = getComputedStyle(element.querySelector('.item-use-card-half.is-right')!)
    return { leftClip: left.clipPath, rightClip: right.clipPath, leftTransform: left.transform, rightTransform: right.transform }
  })
  expect(tear.leftClip).toContain('polygon')
  expect(tear.rightClip).toContain('polygon')
  expect(tear.leftTransform).not.toBe(tear.rightTransform)
  await page.screenshot({ path: testInfo.outputPath('item-card-vertical-tear-1600x900.png'), fullPage: true })
  await usePresentation.evaluate((element) => element.getAnimations({ subtree: true }).forEach((animation) => animation.play()))
  await expect(usePresentation).toHaveCount(0, { timeout: 5_000 })
  await expect(page.getByRole('button', { name: /暂无道具/ })).toBeVisible()
})

test('keeps the current player highlighted until their move presentation finishes', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1600, height: 900 })
  await startGame(page, '1v1', 1, 1)
  const activePlayerName = page.locator('.hud-player.is-active .hud-player-copy strong')
  await expect(activePlayerName).toHaveText('玩家')
  await page.getByRole('button', { name: '投掷双骰' }).click()
  await expect(page.locator('.three-dice-layer')).toHaveClass(/is-rolling/)
  await expect(activePlayerName).toHaveText('玩家')
  await expect(activePlayerName).toHaveText('电脑 1', { timeout: 20_000 })
})

test('shows a clear warning below the supported landscape size', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 })
  await page.goto('/')
  await expect(page.getByRole('status', { name: '桌面窗口尺寸提示' })).toBeVisible()
  await expect(page.getByText('至少 1180 x 680')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(page.getByRole('status', { name: '桌面窗口尺寸提示' })).toBeHidden()
})

test('caps renderer resolution at 2x device pixel ratio', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 })
  const page = await context.newPage()
  await page.goto('/play?mode=1v1&seed=17')
  await waitForBoard(page)
  const ratio = await page.locator('canvas[data-testid="pixi-canvas"]').evaluate((canvas: HTMLCanvasElement) => canvas.width / canvas.getBoundingClientRect().width)
  expect(ratio).toBeGreaterThan(1.9)
  expect(ratio).toBeLessThanOrEqual(2.01)
  await context.close()
})

test('renders near 60 FPS at both release viewports', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport)
    await page.goto('about:blank')
    const runnerFps = await measureFps(page)
    await startGame(page, '1v3', viewport.width)
    const fps = await measureFps(page)
    const renderer = await page.locator('canvas[data-testid="pixi-canvas"]').evaluate((canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      const extension = gl?.getExtension('WEBGL_debug_renderer_info')
      return extension ? gl?.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown'
    })
    console.log(`${viewport.width}x${viewport.height}: runner ${runnerFps.toFixed(1)} FPS, board ${fps.toFixed(1)} FPS, ${renderer}`)
    const minimumFps = String(renderer).includes('SwiftShader') ? 10 : 50
    expect(fps, `${viewport.width}x${viewport.height}: ${fps.toFixed(1)} FPS`).toBeGreaterThanOrEqual(minimumFps)
  }
})

test('finishes a fixed-seed match without game network requests', async ({ page }) => {
  test.setTimeout(90_000)
  const gameRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if ((request.resourceType() === 'xhr' || request.resourceType() === 'fetch') && !url.pathname.startsWith('/assets/')) gameRequests.push(request.url())
  })
  await startGame(page, '1v3', 109)
  await driveUntilFinished(page)
  await expect(page.locator('.win-summary > p')).toContainText(/进入第 (63|64|65) 格/)
  expect(gameRequests).toEqual([])
})
