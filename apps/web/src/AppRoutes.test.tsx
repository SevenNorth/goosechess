// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AppRoutes from './AppRoutes'

describe('客户端路由', () => {
  afterEach(cleanup)

  it('根路由显示人机模式准备', () => {
    render(<MemoryRouter initialEntries={['/']}><AppRoutes /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '选择人机模式' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /1v1/ }).getAttribute('href')).toBe('/play')
  })

  it('play 路由承载现有游戏原型', () => {
    render(<MemoryRouter initialEntries={['/play']}><AppRoutes /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '选择起始道具' })).toBeTruthy()
    expect(screen.getByLabelText('65 格竞速棋盘')).toBeTruthy()
  })

  it('在线房间路由显示未开放状态', () => {
    render(<MemoryRouter initialEntries={['/room/test']}><AppRoutes /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'test' })).toBeTruthy()
    expect(screen.getByText('联机服务尚未开放，这个房间暂时无法加入。')).toBeTruthy()
  })
})
