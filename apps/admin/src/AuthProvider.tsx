import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, contentApi } from './api'
import { AuthContext, type AuthContextValue } from './auth-context'
import type { PublicUser } from './types'

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<PublicUser | null>(null)
  const [permissions, setPermissions] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)

  const restore = useCallback(async () => {
    try {
      const session = await contentApi.session()
      setUser(session.user)
      if (session.user.role === 'content-editor' || session.user.role === 'admin') {
        const me = await contentApi.me()
        setPermissions(me.permissions)
      }
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401)) {
        setError(cause instanceof Error ? cause.message : '无法恢复管理会话。')
      }
      setUser(null)
      setPermissions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void restore()
  }, [restore])

  const login = useCallback(async (username: string, password: string) => {
    setError(null)
    const session = await contentApi.login(username, password)
    setUser(session.user)
    if (session.user.role === 'content-editor' || session.user.role === 'admin') {
      const me = await contentApi.me()
      setPermissions(me.permissions)
    } else {
      setPermissions([])
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await contentApi.logout()
    } finally {
      setUser(null)
      setPermissions([])
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    loading, user, permissions, error, login, logout,
  }), [error, loading, login, logout, permissions, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
