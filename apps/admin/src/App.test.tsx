import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AdminRoutes } from './App'
import { AuthProvider } from './AuthProvider'

vi.mock('./MapPreview', () => ({
  MapPreview: ({
    onAddSpace,
    onAddLocation,
    onSelectSpace,
  }: {
    onAddSpace: (point: { x: number; y: number }) => void
    onAddLocation: (point: { x: number; y: number }) => void
    onSelectSpace: (id: number) => void
  }) => (
    <div aria-label="测试地图画布">
      <button type="button" onClick={() => onAddSpace({ x: 320, y: 180 })}>画布添加格子</button>
      <button type="button" onClick={() => onAddLocation({ x: 500, y: 400 })}>画布添加地点</button>
      <button type="button" onClick={() => onSelectSpace(1)}>画布选择格子 1</button>
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

  it('processes an uploaded image into a skin draft with runtime previews', async () => {
    const skin = {
      id: 'skin-abcdef123456', version: 1, title: '港口巡游鹅', name: '港口巡游鹅',
      atlas: '/content-assets/runtime.png',
      animations: { idle: 'static', active: 'static', hop: 'static', hit: 'static' },
      anchor: { x: 0.5, y: 1 }, shadowScale: 1,
      production: {
        source: '/content-assets/source.png', thumbnail: '/content-assets/thumb.png', shadow: '/content-assets/shadow.png',
        sourceWidth: 512, sourceHeight: 512, subjectWidth: 260, subjectHeight: 380, transparentPixelRatio: 0.62,
      },
    }
    const draft = {
      id: 'skin-draft-1', contentKey: `skin:${skin.id}`, kind: 'skin', title: skin.title,
      status: 'draft', currentRevision: 1, contentHash: 'skin-hash', createdBy: 'admin-1',
      createdAt: 1, updatedAt: 1, validation: { valid: true, issues: [] }, content: skin,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/auth/session') return json({ user: admin, expiresAt: Date.now() + 60_000 })
      if (path === '/admin/me') return json({ user: admin, permissions: ['content:edit', 'content:review', 'content:publish'] })
      if (path === '/admin/skins/process?name=%E6%B8%AF%E5%8F%A3%E5%B7%A1%E6%B8%B8%E9%B9%85' && init?.method === 'POST') return json({ skin }, 201)
      if (path === '/admin/drafts' && init?.method === 'POST') return json({ draft }, 201)
      if (path === '/admin/drafts/skin-draft-1') return json({ draft })
      if (path === '/admin/drafts') return json({ drafts: [] })
      return json({ code: 'not_found', message: path }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderApp('/skins/new')

    fireEvent.change(await screen.findByLabelText('展示名'), { target: { value: '港口巡游鹅' } })
    fireEvent.change(screen.getByLabelText(/选择 PNG/), { target: { files: [new File(['skin'], 'skin.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: '处理并创建草稿' }))

    expect(await screen.findByRole('region', { name: '皮肤使用场景预览' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '港口巡游鹅准备页预览' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '港口巡游鹅棋盘预览' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '港口巡游鹅目标卡预览' })).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/admin/drafts', expect.objectContaining({ method: 'POST' })))
  })
  it('uploads and places a marker image on the canvas with undo and redo', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/auth/session') return json({ user: admin, expiresAt: Date.now() + 60_000 })
      if (path === '/admin/me') return json({ user: admin, permissions: ['content:edit', 'content:review', 'content:publish'] })
      if (path === '/admin/drafts') return json({ drafts: [] })
      if (path === '/admin/assets' && init?.method === 'POST') return json({ asset: { url: '/content-assets/test.png', contentType: 'image/png', size: 8 } }, 201)
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

    fireEvent.change(screen.getByLabelText('添加贴图'), { target: { files: [new File(['image'], 'marker.png', { type: 'image/png' })] } })
    expect(await screen.findByText('贴图已上传，请在画布上点击放置。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '画布添加地点' }))
    expect(screen.getByDisplayValue('新贴图')).toBeTruthy()
    expect(screen.getByDisplayValue('/content-assets/test.png')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: '用途' }) as HTMLSelectElement).value).toBe('decoration')
    const opacity = screen.getByRole('slider', { name: /透明度/ }) as HTMLInputElement
    expect(opacity.value).toBe('100')
    fireEvent.change(opacity, { target: { value: '45' } })
    expect(opacity.value).toBe('45')
    expect(undo.disabled).toBe(false)

    fireEvent.click(undo)
    expect((screen.getByRole('slider', { name: /透明度/ }) as HTMLInputElement).value).toBe('100')
    fireEvent.click(undo)
    expect(screen.queryByDisplayValue('新贴图')).toBeNull()
    expect(redo.disabled).toBe(false)

    fireEvent.click(redo)
    expect(screen.getByDisplayValue('新贴图')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: '事件池' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: '用途' }), { target: { value: 'location' } })
    expect(screen.getByRole('combobox', { name: '事件池' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: '用途' }), { target: { value: 'finish' } })
    expect(screen.queryByRole('combobox', { name: '事件池' })).toBeNull()
  })

  it('binds a winning space through the selected-space type', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/auth/session') return json({ user: admin, expiresAt: Date.now() + 60_000 })
      if (path === '/admin/me') return json({ user: admin, permissions: ['content:edit', 'content:review', 'content:publish'] })
      if (path === '/admin/drafts') return json({ drafts: [] })
      return json({ code: 'not_found', message: path }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderApp('/maps/new')

    expect(await screen.findByRole('button', { name: '画布选择格子 1' })).toBeTruthy()
    expect(screen.queryByText('核心地图校验通过')).toBeNull()
    expect(screen.queryByText('服务端校验通过')).toBeNull()
    expect(screen.queryByLabelText('胜利格 ID')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '画布选择格子 1' }))
    expect(screen.queryByRole('checkbox', { name: 'END 终点格' })).toBeNull()
    const type = screen.getByRole('combobox', { name: '类型' }) as HTMLSelectElement
    expect(type.value).toBe('normal')
    expect(screen.queryByRole('combobox', { name: '事件池' })).toBeNull()
    expect(screen.queryByText('固定路径模拟')).toBeNull()
    const deleteSpace = screen.getByRole('button', { name: '删除格子' })
    fireEvent.click(deleteSpace)
    expect(screen.queryByRole('button', { name: '删除格子' })).toBeNull()

    fireEvent.change(type, { target: { value: 'finish' } })
    expect(type.value).toBe('finish')
    expect(screen.queryByRole('combobox', { name: '事件池' })).toBeNull()
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.change(type, { target: { value: 'normal' } })
    expect(type.value).toBe('normal')
  })

  it('deletes an editable map draft after confirmation', async () => {
    const map = { id: 'draft-map', name: '待删地图', logicalSize: { width: 640, height: 480 }, spaces: [{ index: 0, x: 20, y: 20, rotation: 0, kind: 'start' }, { index: 1, x: 60, y: 20, rotation: 0, kind: 'finish' }], winningSpaceIds: [1], markers: [], eventPools: [], landmarks: [], assets: { background: 'background.png', landmarkAtlas: 'atlas.png' } }
    const draft = { id: 'map-draft-1', contentKey: 'map:draft-map', kind: 'map', title: '待删地图', status: 'draft', currentRevision: 1, contentHash: 'abc', createdBy: 'admin-1', createdAt: 1, updatedAt: 1, validation: { valid: false, issues: [] }, content: map }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/auth/session') return json({ user: admin, expiresAt: Date.now() + 60_000 })
      if (path === '/admin/me') return json({ user: admin, permissions: ['content:edit', 'content:review', 'content:publish'] })
      if (path === '/admin/drafts/map-draft-1' && init?.method === 'DELETE') return new Response(null, { status: 204 })
      if (path === '/admin/drafts/map-draft-1') return json({ draft })
      if (path === '/admin/drafts') return json({ drafts: [draft] })
      return json({ code: 'not_found', message: path }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    renderApp('/maps/map-draft-1')

    fireEvent.click(await screen.findByRole('button', { name: '删除草稿 待删地图' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/admin/drafts/map-draft-1', expect.objectContaining({ method: 'DELETE' })))
    expect(await screen.findByText('选择或创建地图草稿')).toBeTruthy()
  })
})
