import { expect, test, type Page } from '@playwright/test'

async function waitForBoard(page: Page) {
  await expect(page.locator('canvas[data-testid="pixi-canvas"]')).toHaveCount(1)
  await expect(page.getByText('正在铺设奥普港棋盘')).toHaveCount(0)
}

async function startGame(page: Page, mode = '1v1', seed = 3, speed = 20) {
  await page.goto(`/play?mode=${mode}&seed=${seed}&speed=${speed}`)
  await waitForBoard(page)
  await page.getByRole('button', { name: '开始试航' }).click()
  await expect(page.getByRole('button', { name: '投掷双骰' })).toBeEnabled()
}

async function driveUntilFinished(page: Page) {
  for (let step = 0; step < 260; step += 1) {
    if (await page.locator('.win-panel h2').isVisible()) return
    const outcomeContinue = page.getByRole('button', { name: '继续' })
    const eventChoice = page.locator('.event-choice').first()
    const itemChoice = page.locator('.item-compare-grid button').last()
    const roll = page.getByRole('button', { name: '投掷双骰' })
    if (await outcomeContinue.isVisible()) await outcomeContinue.click()
    else if (await eventChoice.isVisible()) await eventChoice.click()
    else if (await itemChoice.isVisible()) await itemChoice.click()
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
  await expect(page.getByRole('button', { name: '开始试航' })).toBeEnabled()
})

test('starts every offline mode with mouse controls only', async ({ page }) => {
  for (const mode of ['1v1', '1v2', '1v3'] as const) {
    await startGame(page, mode, 31)
    await expect(page.getByRole('region', { name: '参赛棋手' }).getByRole('article')).toHaveCount(Number(mode.at(-1)) + 1)
    await page.getByRole('button', { name: '投掷双骰' }).click()
  }
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
