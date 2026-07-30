// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('PixiJS 65 格完整对局', () => {
  afterEach(cleanup)

  async function finishOrderRolls(confirm = true) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const enter = screen.queryByRole('button', { name: '选择起始道具' })
      if (enter) {
        if (confirm) fireEvent.click(enter)
        return
      }
      const orderRoll = screen.queryByRole('button', { name: '投掷单骰' })
      if (orderRoll && !orderRoll.hasAttribute('disabled')) fireEvent.click(orderRoll)
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    }
    throw new Error('座次投掷未在预期时间内完成。')
  }

  async function finishStartingItemChoices(preferredItem?: RegExp) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const roll = screen.queryByRole('button', { name: '投掷双骰' })
      if (roll && !roll.hasAttribute('disabled')) return
      const dialog = screen.queryByRole('dialog', { name: /选择起始道具/ })
      const confirm = screen.queryByRole('button', { name: '确认选择' })
      if (dialog && confirm) {
        const preferred = preferredItem ? within(dialog).queryByRole('radio', { name: preferredItem }) : null
        fireEvent.click(preferred ?? within(dialog).getAllByRole('radio')[0])
        fireEvent.click(confirm)
      }
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    }
    throw new Error('起始道具选择未在预期时间内完成。')
  }

  async function startGame(options: { mode?: '1v1' | '1v2' | '1v3'; seed?: number; startingItem?: RegExp } = {}) {
    render(<App mode={options.mode} seed={options.seed} />)
    fireEvent.click(screen.getByRole('radio', { name: '黄鹅' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /投掷单骰决定顺序|同点小组重新投掷/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '投掷单骰' }))
    await finishOrderRolls()
    await finishStartingItemChoices(options.startingItem)
    await waitFor(() => expect(screen.getByRole('button', { name: '投掷双骰' }).hasAttribute('disabled')).toBe(false))
  }

  it('按模式创建动态座位并完成正式 setup 命令', async () => {
    await startGame({ mode: '1v3', seed: 1 })

    expect(within(screen.getByRole('region', { name: '参赛棋手' })).getAllByRole('article')).toHaveLength(4)
    const playerCards = within(screen.getByRole('region', { name: '参赛棋手' })).getAllByRole('article')
    const opponentCards = playerCards.filter((card) => within(card).queryByTitle(/电脑/) !== null)
    expect(opponentCards).toHaveLength(3)
    for (const opponentCard of opponentCards) expect(opponentCard.querySelector('.hud-player-copy > small')).toBeNull()
    expect(screen.queryByRole('heading', { name: /选择起始道具/ })).toBeNull()
    expect(screen.getByRole('button', { name: /当前道具/ })).toBeTruthy()
  })

  it('完成单骰座次投掷后展示最终顺序', async () => {
    render(<App mode="1v3" seed={7} />)

    await waitFor(() => expect(screen.getByRole('heading', { name: '投掷单骰决定顺序' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '投掷单骰' }))
    await finishOrderRolls(false)
    expect(screen.getByRole('button', { name: '选择起始道具' })).toBeTruthy()
    expect(within(screen.getByRole('dialog', { name: '行动顺序已确定' })).getAllByRole('listitem')).toHaveLength(4)
  })

  it('座次确定后为本地玩家展示抽取的三件起始道具', async () => {
    render(<App mode="1v2" seed={13} />)
    fireEvent.click(screen.getByRole('button', { name: '投掷单骰' }))
    await finishOrderRolls()

    const dialog = await screen.findByRole('dialog', { name: /选择起始道具/ })
    expect(within(dialog).getAllByRole('radio')).toHaveLength(3)
  })

  it('通过 authority 投掷双骰并更新本地棋手位置', async () => {
    await startGame({ seed: 1 })
    const playerRegion = screen.getByRole('region', { name: '参赛棋手' })
    expect(document.querySelector('.dice-readout')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '投掷双骰' }))

    await waitFor(() => expect(within(playerRegion).queryByText('0 / 65')).toBeNull())
  })

  it('固定种子流程落到事件格后显示三张事件牌', async () => {
    await startGame({ seed: 3 })

    for (let turn = 0; turn < 12 && !screen.queryByRole('heading', { name: '从三张牌中选择' }); turn += 1) {
      const roll = screen.getByRole('button', { name: '投掷双骰' })
      fireEvent.click(roll)
      await waitFor(() => expect(
        screen.queryByRole('heading', { name: '从三张牌中选择' })
          ?? (!roll.hasAttribute('disabled') ? roll : null),
      ).toBeTruthy(), { timeout: 3000 })
    }

    expect(screen.getByRole('heading', { name: '从三张牌中选择' })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '从三张牌中选择' })).getAllByRole('button')).toHaveLength(3)
  })

  it('重新开始会重新进入座次投掷并保持模式人数', async () => {
    await startGame({ mode: '1v2', seed: 8 })
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }))

    expect(screen.getByRole('heading', { name: '投掷单骰决定顺序' })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '参赛棋手' })).getAllByRole('article')).toHaveLength(3)
  })

  it('在提供退出回调时显示返回首页按钮', () => {
    const onExit = vi.fn()
    render(<App onExit={onExit} />)

    fireEvent.click(screen.getByRole('button', { name: '返回首页' }))

    expect(onExit).toHaveBeenCalledOnce()
  })

  it('通过居中确认弹窗使用主动道具', async () => {
    await startGame({ seed: 12, startingItem: /轻便靴子/ })

    fireEvent.click(screen.getByRole('button', { name: /当前道具.*轻便靴子/ }))
    const dialog = screen.getByRole('dialog', { name: '使用轻便靴子' })

    expect(within(dialog).getByRole('button', { name: '取消' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '确认使用' }))
    const itemUse = await screen.findByRole('status', { name: '玩家使用轻便靴子' })
    expect(itemUse.querySelector('.item-use-flight.is-local')).toBeTruthy()
    expect(itemUse.querySelectorAll('.item-use-card-half')).toHaveLength(2)
    fireEvent.animationEnd(itemUse.querySelector('.item-use-flight')!)
    await waitFor(() => expect(screen.getByRole('button', { name: /暂无道具/ })).toBeTruthy())
  })
})
