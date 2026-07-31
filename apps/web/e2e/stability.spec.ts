import { expect, test, type Page } from '@playwright/test'

test.use({ trace: 'off', screenshot: 'off' })

async function tryClick(locator: ReturnType<Page['locator']>) {
  if (await locator.count() === 0) return false
  try {
    await locator.click({ timeout: 1_000 })
    return true
  } catch {
    return false
  }
}

async function clickNextAction(page: Page) {
  const startingItemConfirm = page.getByRole('button', { name: '确认选择' })
  const restart = page.getByRole('button', { name: '再来一局' })
  const outcome = page.getByRole('button', { name: '继续' })
  const event = page.locator('.event-choice').first()
  const item = page.locator('.item-compare-grid button').last()
  const itemConfirm = page.getByRole('button', { name: '确认保留' })
  const orderRoll = page.getByRole('button', { name: '投掷单骰' })
  const tieContinue = page.getByRole('button', { name: /再次投掷|继续/ })
  const orderConfirm = page.getByRole('button', { name: '选择起始道具' })
  const roll = page.getByRole('button', { name: '投掷双骰' })
  if (await tryClick(tieContinue)) return 'order-tie'
  if (await tryClick(orderRoll)) return 'order-roll'
  if (await tryClick(orderConfirm)) return 'order-confirm'
  if (await tryClick(startingItemConfirm)) return 'starting-item'
  if (await tryClick(restart)) return 'restart'
  if (await tryClick(outcome)) return 'outcome'
  if (await tryClick(event)) return 'event'
  if (await tryClick(item)) {
    await tryClick(itemConfirm)
    return 'item'
  }
  if (await tryClick(roll)) return 'roll'
  await page.waitForTimeout(25)
  return 'wait'
}

test('keeps scene resources and memory bounded during continuous play', async ({ page, context }) => {
  test.skip(process.env.RUN_STABILITY !== '1', 'Run with npm run e2e:stability.')
  const minutes = Number(process.env.STABILITY_MINUTES ?? 30)
  const durationMs = minutes * 60_000
  test.setTimeout(durationMs + 120_000)
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`Browser console: ${message.text()}`)
  })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/play?mode=1v3&seed=907&speed=20')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reload = page.getByRole('button', { name: '重新加载' })
    await expect.poll(async () => await page.locator('canvas[data-testid="pixi-canvas"]').count() + await reload.count(), { timeout: 30_000 }).toBeGreaterThan(0)
    if (await reload.count() > 0) await reload.click()
    else break
  }
  await expect(page.locator('canvas[data-testid="pixi-canvas"]')).toHaveCount(1, { timeout: 30_000 })
  await expect(page.getByText('正在铺设奥普港棋盘')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByRole('button', { name: '投掷单骰' })).toBeEnabled()

  const session = await context.newCDPSession(page)
  await session.send('HeapProfiler.collectGarbage')
  const readHeap = () => page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0)
  const baselineHeap = await readHeap()
  const diagnostics = []
  let completedMatches = 0
  const started = Date.now()
  let nextSample = started
  let nextHeartbeat = started + 5 * 60_000
  while (Date.now() - started < durationMs) {
    if (await clickNextAction(page) === 'restart') completedMatches += 1
    if (Date.now() >= nextSample) {
      diagnostics.push(await page.evaluate(() => window.__GOOSE_CHESS_DIAGNOSTICS__?.()))
      nextSample = Date.now() + 10_000
    }
    if (Date.now() >= nextHeartbeat) {
      console.log(`Stability progress: ${Math.floor((Date.now() - started) / 60_000)} / ${minutes} min; ${completedMatches} completed matches.`)
      nextHeartbeat += 5 * 60_000
    }
  }

  for (let attempt = 0; attempt < 100; attempt += 1) {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForTimeout(100)
    const current = await page.evaluate(() => window.__GOOSE_CHESS_DIAGNOSTICS__?.())
    if (current?.windowListeners === 0 && current.activeTweens === 0) {
      await page.waitForTimeout(350)
      const stable = await page.evaluate(() => window.__GOOSE_CHESS_DIAGNOSTICS__?.())
      if (stable?.windowListeners === 0 && stable.activeTweens === 0) break
    }
  }
  await expect(page.locator('.round-float span')).toHaveText('等待行动')
  await session.send('HeapProfiler.collectGarbage')
  const finalHeap = await readHeap()
  const finalDiagnostics = await page.evaluate(() => window.__GOOSE_CHESS_DIAGNOSTICS__?.())

  expect(await page.locator('canvas[data-testid="pixi-canvas"]').count()).toBe(1)
  expect(finalDiagnostics).toMatchObject({ activeScenes: 1, tickerHandlers: 1, loadedTextures: 15, windowListeners: 0, activeTweens: 0 })
  for (const sample of diagnostics) {
    expect(sample?.activeScenes).toBe(1)
    expect(sample?.tickerHandlers).toBe(1)
    expect(sample?.loadedTextures).toBe(15)
    expect(sample?.windowListeners).toBeLessThanOrEqual(1)
  }
  if (baselineHeap > 0 && finalHeap > 0) {
    expect(finalHeap - baselineHeap, `heap grew from ${baselineHeap} to ${finalHeap}`).toBeLessThan(Math.max(40 * 1024 * 1024, baselineHeap * 0.7))
  }
  console.log(`Stability ${minutes} min: ${completedMatches} completed matches; heap ${baselineHeap} -> ${finalHeap}; ${diagnostics.length} diagnostic samples.`)
})
