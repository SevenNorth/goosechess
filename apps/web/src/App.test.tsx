// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

describe('PixiJS 核心体验样片', () => {
  afterEach(cleanup)

  async function startGame(options: { mode?: '1v1' | '1v2' | '1v3'; seed?: number } = {}) {
    render(<App mode={options.mode} seed={options.seed} />)
    fireEvent.click(screen.getByRole('radio', { name: '黄鹅' }))
    fireEvent.click(screen.getByRole('button', { name: /四叶草/ }))
    fireEvent.click(screen.getByRole('button', { name: '开始试航' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '投掷双骰' }).hasAttribute('disabled')).toBe(false))
  }

  it('按模式创建动态座位并完成正式 setup 命令', async () => {
    await startGame({ mode: '1v3', seed: 1 })

    expect(within(screen.getByRole('region', { name: '参赛棋手' })).getAllByRole('article')).toHaveLength(4)
    expect(screen.queryByRole('heading', { name: '选择棋子与起始道具' })).toBeNull()
    expect(screen.getByRole('button', { name: /四叶草/ })).toBeTruthy()
  })

  it('通过 authority 投掷双骰并更新本地棋手位置', async () => {
    await startGame({ seed: 1 })
    const playerRegion = screen.getByRole('region', { name: '参赛棋手' })

    fireEvent.click(screen.getByRole('button', { name: '投掷双骰' }))

    await waitFor(() => expect(within(playerRegion).queryByText('0 / 15')).toBeNull())
    expect(screen.getByText('合计').nextElementSibling?.textContent).not.toBe('--')
  })

  it('固定种子落到事件格后显示三张事件牌', async () => {
    await startGame({ seed: 3 })

    fireEvent.click(screen.getByRole('button', { name: '投掷双骰' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: '从三张牌中选择' })).toBeTruthy())
    expect(within(screen.getByRole('region', { name: '从三张牌中选择' })).getAllByRole('button')).toHaveLength(3)
  })

  it('重新开始会重新进入 setup 并保持模式人数', async () => {
    await startGame({ mode: '1v2', seed: 8 })
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }))

    expect(screen.getByRole('heading', { name: '选择棋子与起始道具' })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '参赛棋手' })).getAllByRole('article')).toHaveLength(3)
  })
})
