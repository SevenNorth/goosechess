// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AppRoutes from './AppRoutes'
import { parseSeedParameter } from './match-seed'

describe('客户端路由', () => {
  afterEach(cleanup)

  it('根路由显示人机模式准备', () => {
    render(<MemoryRouter initialEntries={['/']}><AppRoutes /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '选择人机模式' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /1v1/ }).getAttribute('aria-checked')).toBe('true')
    const initialHref = screen.getByRole('link', { name: '开始对局' }).getAttribute('href')
    expect(initialHref).toMatch(/^\/play\?mode=1v1&seed=\d+$/)

    fireEvent.click(screen.getByRole('radio', { name: /1v3/ }))
    expect(screen.getByRole('link', { name: '开始对局' }).getAttribute('href')).toBe(initialHref?.replace('mode=1v1', 'mode=1v3'))
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
