import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

async function completeOrderRolls(page: Page) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const confirm = page.getByRole('button', { name: '进入第一回合' })
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

async function startGame(page: Page, mode = '1v1', seed = 3, speed = 1) {
  await page.goto(`/play?mode=${mode}&seed=${seed}&speed=${speed}`)
  await expect(page.getByRole('heading', { name: '选择棋子与起始道具' })).toBeVisible()
  await expect(page.locator('canvas[data-testid="pixi-canvas"]')).toHaveCount(1)
  await page.getByRole('radio', { name: '黄鹅' }).click()
  await page.getByRole('button', { name: /四叶草/ }).click()
  await page.getByRole('button', { name: '开始试航' }).click()
  await completeOrderRolls(page)
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
  await startGame(page, '1v1', 6)
  await page.evaluate(() => {
    const target = document.querySelector('.round-float span')
    ;(window as typeof window & { __stage6States?: string[] }).__stage6States = target?.textContent ? [target.textContent] : []
    if (target) new MutationObserver(() => {
      const text = target.textContent
      if (text) (window as typeof window & { __stage6States?: string[] }).__stage6States?.push(text)
    }).observe(target, { childList: true, subtree: true, characterData: true })
  })
  await page.getByRole('button', { name: '投掷双骰' }).click()
  await expect(page.locator('.round-float span')).toHaveText('骰子滚动')
  await expect(page.getByRole('heading', { name: '从三张牌中选择' })).toBeVisible()
  await expect(page.locator('.round-float span')).toHaveText('等待行动')
  const states = await page.evaluate(() => (window as typeof window & { __stage6States?: string[] }).__stage6States ?? [])
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
  await startGame(page, '1v1', 6)
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
  await startGame(page, '1v1', 6)
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
