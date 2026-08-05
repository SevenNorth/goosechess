import { lazy, Suspense, useState, type FormEvent } from 'react'
import {
  Activity,
  BookOpenCheck,
  ChevronRight,
  FileClock,
  LogOut,
  Map,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { ApiError } from './api'
import { useAuth } from './auth-context'
import { AuditPage, EventWorkspace, ReleasesPage } from './EventEditor'
const MapWorkspace = lazy(() => import('./MapEditor').then((module) => ({ default: module.MapWorkspace })))

function LoadingScreen() {
  return (
    <main className="center-state" aria-label="正在恢复管理会话">
      <span className="loading-mark" aria-hidden="true">鹅</span>
      <strong>正在连接内容服务</strong>
    </main>
  )
}

function LoginPage() {
  const { user, login, error: restoreError } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(restoreError)

  if (user) return <Navigate to="/events" replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(username, password)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '登录失败，请检查内容服务。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-brand" aria-label="鹅了个棋内容管理">
        <span aria-hidden="true">鹅</span>
        <div>
          <small>GOOSE CHESS OPERATIONS</small>
          <h1>内容管理台</h1>
          <p>事件、地图与外观内容的受控发布入口</p>
        </div>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-panel-heading">
          <ShieldAlert aria-hidden="true" />
          <div>
            <span>受保护区域</span>
            <h2 id="login-title">账号登录</h2>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <label>
            <span>用户名</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
          </label>
          <label>
            <span>密码</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? '正在验证' : '进入管理台'}
            <ChevronRight aria-hidden="true" />
          </button>
        </form>
      </section>
    </main>
  )
}

function AccessDenied() {
  const { user, logout } = useAuth()
  return (
    <main className="center-state">
      <ShieldAlert aria-hidden="true" />
      <strong>当前账号没有管理权限</strong>
      <p>{user?.displayName} 的角色为 player，仅能进入玩家客户端。</p>
      <button className="secondary-button" type="button" onClick={() => void logout()}>
        <LogOut aria-hidden="true" />退出账号
      </button>
    </main>
  )
}

function ProtectedLayout() {
  const { loading, user } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'player') return <AccessDenied />
  return <AdminLayout />
}

const navigation = [
  { to: '/events', label: '事件内容', icon: Sparkles },
  { to: '/maps', label: '\u5730\u56fe\u5185\u5bb9', icon: Map },
  { to: '/releases', label: '发布版本', icon: BookOpenCheck },
  { to: '/audit', label: '操作审计', icon: FileClock, adminOnly: true },
]

function AdminLayout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span aria-hidden="true">鹅</span>
          <div><strong>内容管理台</strong><small>Goose Chess</small></div>
        </div>
        <nav aria-label="管理功能">
          {navigation.filter((item) => !item.adminOnly || user?.role === 'admin').map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'is-active' : ''}>
                <Icon aria-hidden="true" /><span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className="service-status"><Activity aria-hidden="true" /><span>内容服务</span><strong>在线</strong></div>
        <div className="account-block">
          <div className="account-avatar">{user?.displayName.slice(0, 1)}</div>
          <div><strong>{user?.displayName}</strong><small>{user?.role}</small></div>
          <button type="button" title="退出账号" aria-label="退出账号" onClick={() => void logout()}><LogOut /></button>
        </div>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar">
          <div><small>内容平台</small><strong>{navigation.find((item) => location.pathname.startsWith(item.to))?.label ?? '管理台'}</strong></div>
          <span className="environment-tag">本地环境</span>
        </header>
        <div className="admin-content"><Outlet /></div>
      </section>
    </div>
  )
}

export function AdminRoutes() {
  const { loading } = useAuth()
  if (loading) return <LoadingScreen />
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<Navigate to="/events" replace />} />
        <Route path="events" element={<EventWorkspace />} />
        <Route path="events/:draftId" element={<EventWorkspace />} />
        <Route path="maps" element={<Suspense fallback={<LoadingScreen />}><MapWorkspace /></Suspense>} />
        <Route path="maps/:draftId" element={<Suspense fallback={<LoadingScreen />}><MapWorkspace /></Suspense>} />
        <Route path="releases" element={<ReleasesPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/events" replace />} />
    </Routes>
  )
}
