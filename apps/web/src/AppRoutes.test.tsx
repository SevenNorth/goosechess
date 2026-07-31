// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AppRoutes from './AppRoutes'
import { parseSeedParameter } from './match-seed'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location-probe">{location.pathname + location.search}</output>
}

describe('客户端路由', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('根路由配置玩家档案与本局阵容后进入对局', () => {
    render(<MemoryRouter initialEntries={['/']}><AppRoutes /><LocationProbe /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '配置本局棋手' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /1v1/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('img', { name: '妮露棋子预览' }).getAttribute('src')).toBe('/assets/tokens/characters/nilou.png')

    fireEvent.click(screen.getByRole('radio', { name: /1v3/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /昵称/ }), { target: { value: '海风Captain' } })
    fireEvent.click(screen.getByRole('radio', { name: '魈' }))
    fireEvent.click(screen.getByRole('button', { name: '开始对局' }))

    const location = screen.getByTestId('location-probe').textContent ?? ''
    expect(location).toMatch(/^\/play\?mode=1v3&seed=\d+/)
    expect(location).toContain('name=%E6%B5%B7%E9%A3%8ECaptain')
    expect(location).toContain('skin=goose-yellow')
  })

  it('个人信息侧栏可收起并阻止超长昵称开始对局', () => {
    render(<MemoryRouter initialEntries={['/']}><AppRoutes /></MemoryRouter>)

    expect(screen.getByRole('complementary', { name: '个人信息' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭个人信息' }))
    expect(screen.queryByRole('complementary', { name: '个人信息' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '个人信息' }))

    fireEvent.change(screen.getByRole('textbox', { name: /昵称/ }), { target: { value: '一二三四五六七八' } })
    expect(screen.getByText('中文最多 7 个，英文最多 14 个')).toBeTruthy()
    expect(screen.getByRole('button', { name: '开始对局' }).hasAttribute('disabled')).toBe(true)
  })

  it('区分缺失种子与显式的零种子', () => {
    expect(parseSeedParameter(null)).toBeNull()
    expect(parseSeedParameter('')).toBeNull()
    expect(parseSeedParameter('not-a-number')).toBeNull()
    expect(parseSeedParameter('0')).toBe(0)
    expect(parseSeedParameter('4294967295')).toBe(0xffff_ffff)
  })

  it('play 路由承载 PixiJS 65 格完整对局', () => {
    render(<MemoryRouter initialEntries={['/play']}><AppRoutes /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '投掷单骰决定顺序' })).toBeTruthy()
    expect(screen.getByLabelText('65 格 PixiJS 竞速棋盘')).toBeTruthy()
  })

  it('在线房间路由显示未开放状态', () => {
    render(<MemoryRouter initialEntries={['/room/test']}><AppRoutes /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'test' })).toBeTruthy()
    expect(screen.getByText('联机服务尚未开放，这个房间暂时无法加入。')).toBeTruthy()
  })
})
