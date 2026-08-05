import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AdminRoutes } from './App'
import { AuthProvider } from './AuthProvider'

vi.mock('./MapPreview', () => ({
  MapPreview: ({
    onAddSpace,
    onAddLocation,
  }: {
    onAddSpace: (point: { x: number; y: number }) => void
    onAddLocation: (point: { x: number; y: number }) => void
  }) => (
    <div aria-label="测试地图画布">
      <button type="button" onClick={() => onAddSpace({ x: 320, y: 180 })}>画布添加格子</button>
      <button type="button" onClick={() => onAddLocation({ x: 500, y: 400 })}>画布添加地点</button>
    </div>
  ),
}))

const admin = { id: 'admin-1', username: 'admin', displayName: '港口管理员', role: 'admin' }
const player = { id: 'player-1', username: 'player', displayName: '普通玩家', role: 'player' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><AdminRoutes /></AuthProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('admin application access and event workflow', () => {
  it('sends unauthenticated visitors to the login screen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'unauthenticated', message: '请先登录。' }, 401)))
    renderApp('/events')
    expect(await screen.findByRole('heading', { name: '账号登录' })).toBeTruthy()
  })

  it('blocks player accounts from every management route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ user: player, expiresAt: Date.now() + 60_000 })))
    renderApp('/events')
    expect(await screen.findByText('当前账号没有管理权限')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: '管理功能' })).toBeNull()
  })

  it('lets an admin create an event draft and shows automatic validation', async () => {
    const createdDraft = {
      id: 'draft-1', contentKey: 'event:harbor-shortcut', kind: 'event', title: '港口捷径',
      status: 'draft', currentRevision: 1, contentHash: 'abc', createdBy: 'admin-1',
      createdAt: 1, updatedAt: 1,
      validation: { valid: true, issues: [] },
      content: {
        id: 'harbor-shortcut', title: '港口捷径', flavor: '沿着码头抄近路。',
        kind: '常规事件', accent: 'teal', aiValue: 5, weight: 1,
        poolIds: ['general'], effect: [{ type: 'move', spaces: 1 }], successText: '前进一格。',
      },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/auth/session') return json({ user: admin, expiresAt: Date.now() + 60_000 })
      if (path === '/admin/me') return json({ user: admin, permissions: ['content:edit', 'content:review', 'content:publish'] })
      if (path === '/admin/drafts' && init?.method === 'POST') return json({ draft: createdDraft }, 201)
      if (path === '/admin/drafts') return json({ drafts: [] })
      if (path === '/admin/drafts/draft-1') return json({ draft: createdDraft })
      return json({ code: 'not_found', message: path }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderApp('/events/new')

    fireEvent.change(await screen.findByLabelText('事件 ID'), { target: { value: 'harbor-shortcut' } })
    fireEvent.change(screen.getByLabelText('事件标题'), { target: { value: '港口捷径' } })
    fireEvent.change(screen.getByLabelText('叙事说明'), { target: { value: '沿着码头抄近路。' } })
    fireEvent.change(screen.getByLabelText('结果文案'), { target: { value: '前进一格。' } })
    fireEvent.click(screen.getByRole('button', { name: '打开三选一预览' }))
    expect(screen.getByRole('dialog', { name: '三选一事件预览' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭三选一预览' }))

    fireEvent.click(screen.getByRole('button', { name: '保存修订' }))

    expect(await screen.findByText('修订 1 已保存并完成自动校验。')).toBeTruthy()
    expect(screen.getByText('自动校验通过')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/admin/drafts', expect.objectContaining({ method: 'POST' })))
  })
  it('connects canvas tools to map history with undo and redo', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/auth/session') return json({ user: admin, expiresAt: Date.now() + 60_000 })
      if (path === '/admin/me') return json({ user: admin, permissions: ['content:edit', 'content:review', 'content:publish'] })
      if (path === '/admin/drafts') return json({ drafts: [] })
      return json({ code: 'not_found', message: path }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderApp('/maps/new')

    const undo = await screen.findByRole('button', { name: '撤销' }) as HTMLButtonElement
    const redo = screen.getByRole('button', { name: '重做' }) as HTMLButtonElement
    expect(undo.disabled).toBe(true)
    expect(redo.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '添加格子' }))
    expect(screen.getByRole('button', { name: '添加格子' }).classList.contains('is-active')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '画布添加地点' }))
    expect(screen.getByDisplayValue('新地点')).toBeTruthy()
    expect(undo.disabled).toBe(false)

    fireEvent.click(undo)
    expect(screen.queryByDisplayValue('新地点')).toBeNull()
    expect(redo.disabled).toBe(false)

    fireEvent.click(redo)
    expect(screen.getByDisplayValue('新地点')).toBeTruthy()
  })
})
