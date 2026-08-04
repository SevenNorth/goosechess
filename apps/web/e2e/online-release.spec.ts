import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const LATENCY_MS = 250

interface LatencyDiagnostics {
  authorityRevisions: number[]
  duplicateGameCommandCopies: number
  serverMessages: number
}

function delay(duration: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, duration))
}

async function configurePlayer(page: Page, nickname: string) {
  await page.goto('/')
  await page.getByLabel('昵称').fill(nickname)
}

async function createRoom(page: Page) {
  await page.getByRole('button', { name: '创建房间' }).click()
  await expect(page).toHaveURL(/\/room\/[A-Z0-9]{6}$/)
  await expect(page.getByRole('region', { name: '等待棋手准备' })).toBeVisible()
  return page.url().split('/').at(-1)!
}

async function joinRoom(page: Page, roomCode: string) {
  await page.getByRole('textbox', { name: '6 位房间码' }).fill(roomCode)
  await page.getByRole('button', { name: '加入', exact: true }).click()
  await expect(page).toHaveURL('/room/' + roomCode)
  await expect(page.getByRole('region', { name: '等待棋手准备' })).toBeVisible()
}

async function waitForBoard(page: Page) {
  await expect(page.locator('canvas[data-testid="pixi-canvas"]')).toHaveCount(1)
  await expect(page.getByText('正在铺设奥普港棋盘')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /投掷单骰决定顺序|同点小组重新投掷/ })).toBeVisible()
}

async function storedPlayerId(page: Page, roomCode: string) {
  return page.evaluate((code) => {
    const stored = sessionStorage.getItem('goose-chess-online-room-v1:' + code)
    return stored ? (JSON.parse(stored) as { playerId?: string }).playerId : undefined
  }, roomCode)
}

async function installHighLatencyTransport(context: BrowserContext): Promise<LatencyDiagnostics> {
  const diagnostics: LatencyDiagnostics = {
    authorityRevisions: [],
    duplicateGameCommandCopies: 0,
    serverMessages: 0,
  }

  await context.routeWebSocket(/\/rooms\/[A-Z0-9]{6}\/connect\?/, (pageSocket) => {
    const serverSocket = pageSocket.connectToServer()
    let toServer = Promise.resolve()
    let toPage = Promise.resolve()

    pageSocket.onMessage((message) => {
      toServer = toServer.then(async () => {
        await delay(LATENCY_MS)
        serverSocket.send(message)
        const parsed = typeof message === 'string' ? JSON.parse(message) as { type?: string } : null
        if (parsed?.type === 'command') {
          await delay(20)
          serverSocket.send(message)
          diagnostics.duplicateGameCommandCopies += 2
        }
      }).catch(() => undefined)
    })

    serverSocket.onMessage((message) => {
      toPage = toPage.then(async () => {
        await delay(LATENCY_MS)
        pageSocket.send(message)
        diagnostics.serverMessages += 1
        if (typeof message !== 'string') return
        const parsed = JSON.parse(message) as {
          type?: string
          update?: { snapshot?: { revision?: number } }
        }
        if (parsed.type === 'authority-update' && typeof parsed.update?.snapshot?.revision === 'number') {
          diagnostics.authorityRevisions.push(parsed.update.snapshot.revision)
        }
        if (parsed.type === 'room-state' || parsed.type === 'authority-update') {
          await delay(20)
          pageSocket.send(message)
          diagnostics.serverMessages += 1
          if (parsed.type === 'authority-update' && typeof parsed.update?.snapshot?.revision === 'number') {
            diagnostics.authorityRevisions.push(parsed.update.snapshot.revision)
          }
        }
      }).catch(() => undefined)
    })
  })

  return diagnostics
}

test('creates, joins, starts, and restores the same seat after refresh', async ({ browser }) => {
  test.setTimeout(90_000)
  const hostContext = await browser.newContext({ viewport: { width: 1600, height: 900 } })
  const guestContext = await browser.newContext({ viewport: { width: 1600, height: 900 } })

  try {
    const host = await hostContext.newPage()
    const guest = await guestContext.newPage()
    await configurePlayer(host, '港口房主')
    const roomCode = await createRoom(host)
    await configurePlayer(guest, '远航棋手')
    await joinRoom(guest, roomCode)

    const hostRoster = host.locator('.online-player-list article:not(.is-empty)')
    const guestRoster = guest.locator('.online-player-list article:not(.is-empty)')
    await expect(hostRoster).toHaveCount(2)
    await expect(guestRoster).toHaveCount(2)
    const originalOrder = await guestRoster.locator('strong').allTextContents()
    const originalPlayerId = await storedPlayerId(guest, roomCode)
    expect(originalPlayerId).toBeTruthy()

    await guest.getByRole('button', { name: '准备', exact: true }).click()
    await expect(guest.getByRole('button', { name: '取消准备' })).toBeVisible()
    await expect(host.locator('.lobby-readiness strong')).toHaveText('1/2')

    await guest.reload()
    await expect(guest.getByRole('region', { name: '等待棋手准备' })).toBeVisible()
    await expect(guest.locator('.room-connection')).toContainText('已连接')
    await expect(guest.getByRole('button', { name: '取消准备' })).toBeVisible()
    expect(await guestRoster.locator('strong').allTextContents()).toEqual(originalOrder)
    expect(await storedPlayerId(guest, roomCode)).toBe(originalPlayerId)

    await host.getByRole('button', { name: '准备', exact: true }).click()
    await expect(host.locator('.lobby-readiness strong')).toHaveText('2/2')
    const start = host.getByRole('button', { name: '开始对局' })
    await expect(start).toBeEnabled()
    await start.click()
    await Promise.all([waitForBoard(host), waitForBoard(guest)])

    await guest.reload()
    await waitForBoard(guest)
    await expect(guest.locator('.online-match-connection')).toContainText('已连接')
    expect(await storedPlayerId(guest, roomCode)).toBe(originalPlayerId)
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()])
  }
})

test('remains authoritative with delayed and duplicated WebSocket messages', async ({ browser }) => {
  test.setTimeout(90_000)
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })

  try {
    const diagnostics = await installHighLatencyTransport(context)
    const page = await context.newPage()
    await configurePlayer(page, '延迟测试员')
    await createRoom(page)

    const roster = page.locator('.online-player-list article:not(.is-empty)')
    const addAi = page.getByRole('button', { name: '添加电脑' })
    const startedAt = Date.now()
    await addAi.click()
    await expect(addAi).toBeDisabled()
    await expect(roster).toHaveCount(2)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(LATENCY_MS * 2 - 75)

    await page.getByRole('button', { name: '准备', exact: true }).click()
    const start = page.getByRole('button', { name: '开始对局' })
    await expect(start).toBeEnabled()
    await start.click()
    await waitForBoard(page)

    const roll = page.getByRole('button', { name: '投掷单骰' })
    await expect(roll).toBeEnabled()
    await roll.click()
    await expect.poll(() => diagnostics.duplicateGameCommandCopies).toBe(2)
    await expect.poll(() => diagnostics.authorityRevisions.length).toBeGreaterThanOrEqual(2)
    expect(diagnostics.authorityRevisions).toEqual([...diagnostics.authorityRevisions].sort((left, right) => left - right))
    expect(new Set(diagnostics.authorityRevisions).size).toBeLessThan(diagnostics.authorityRevisions.length)
    expect(diagnostics.serverMessages).toBeGreaterThan(0)
    await expect(page.locator('.online-match-connection')).toContainText('已连接')
  } finally {
    await context.close()
  }
})