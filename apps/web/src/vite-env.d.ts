/// <reference types="vite/client" />

interface Window {
  __GOOSE_CHESS_DIAGNOSTICS__?: () => import('./scene/BoardScene').BoardSceneDiagnostics
}
