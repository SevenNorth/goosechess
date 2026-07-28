import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

async function startSample(page: Page, mode = '1v1', seed = 3) {
  await page.goto(`/play?mode=${mode}&seed=${seed}`)
  await expect(page.getByRole('heading', { name: '选择棋子与起始道具' })).toBeVisible()
  await expect(page.locator('canvas[data-testid="pixi-canvas"]')).toHaveCount(1)
  await page.getByRole('radio', { name: '黄鹅' }).click()
  await page.getByRole('button', { name: /四叶草/ }).click()
  await page.getByRole('button', { name: '开始试航' }).click()
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

test('renders a nonblank complete board at all desktop targets', async ({ page }, testInfo) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport)
    await startSample(page, '1v3', 3)
    const canvas = page.locator('canvas[data-testid="pixi-canvas"]')
    const bounds = await canvas.boundingBox()
    expect(bounds?.width).toBe(viewport.width)
    expect(bounds?.height).toBe(viewport.height - 68)
    const pixels = await canvasPixelStats(page)
    const canvasArea = (bounds?.width ?? 0) * (bounds?.height ?? 0)
    expect(pixels.opaque).toBeGreaterThan(canvasArea * 0.95)
    expect(pixels.varied).toBeGreaterThan(canvasArea * 0.2)
    await page.screenshot({ path: testInfo.outputPath(`stage5-${viewport.width}x${viewport.height}.png`), fullPage: true })
  }
})

test('plays route states in order before opening an event', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await startSample(page, '1v1', 3)
  await page.evaluate(() => {
    const target = document.querySelector('.round-float span')
    ;(window as typeof window & { __stage5States?: string[] }).__stage5States = target?.textContent ? [target.textContent] : []
    if (target) new MutationObserver(() => {
      const text = target.textContent
      if (text) (window as typeof window & { __stage5States?: string[] }).__stage5States?.push(text)
    }).observe(target, { childList: true, subtree: true, characterData: true })
  })
  await page.getByRole('button', { name: '投掷双骰' }).click()
  await expect(page.locator('.round-float span')).toHaveText('骰子滚动')
  await expect(page.getByRole('heading', { name: '从三张牌中选择' })).toBeVisible()
  await expect(page.locator('.round-float span')).toHaveText('等待行动')
  const states = await page.evaluate(() => (window as typeof window & { __stage5States?: string[] }).__stage5States ?? [])
  const expected = ['骰子滚动', '路线预览', '目标锁定', '路线收起', '棋子移动', '等待行动']
  let cursor = -1
  for (const state of expected) {
    const next = states.indexOf(state, cursor + 1)
    expect(next, `${state} missing from ${states.join(' > ')}`).toBeGreaterThan(cursor)
    cursor = next
  }
})

test('resolves a dice-check event and shows its outcome', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await startSample(page, '1v1', 3)
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
  await startSample(page, '1v1', 3)
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
    await expect(page.getByRole('heading', { name: '选择棋子与起始道具' })).toBeVisible()
  }
  expect(await page.locator('canvas[data-testid="pixi-canvas"]').count()).toBe(1)
})
