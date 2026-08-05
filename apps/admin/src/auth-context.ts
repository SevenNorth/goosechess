import { createContext, useContext } from 'react'
import type { PublicUser } from './types'

export interface AuthContextValue {
  readonly loading: boolean
  readonly user: PublicUser | null
  readonly permissions: readonly string[]
  readonly error: string | null
  login(username: string, password: string): Promise<void>
  logout(): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}
