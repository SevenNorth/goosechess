import type { RoomStoreDiagnostics } from './room-store.js'

type MetricLabels = Readonly<Record<string, string | number>>

interface MetricSeries {
  readonly name: string
  readonly labels: MetricLabels
  value: number
}

const METRIC_HELP = {
  goose_chess_diagnostics_total: 'Structured diagnostic events emitted by severity and event.',
  goose_chess_http_request_duration_seconds_count: 'Number of timed HTTP requests.',
  goose_chess_http_request_duration_seconds_sum: 'Total duration of HTTP requests in seconds.',
  goose_chess_http_requests_total: 'HTTP requests by normalized route, method, and status.',
  goose_chess_protocol_messages_total: 'Inbound WebSocket protocol messages by type and outcome.',
  goose_chess_room_ownership_events_total: 'Room lease ownership events by bounded type.',
  goose_chess_rate_limit_rejections_total: 'Requests rejected by a server rate limit.',
  goose_chess_room_commands_total: 'Lobby and authority commands by outcome and bounded result code.',
  goose_chess_ws_connections_total: 'WebSocket connections accepted since process start.',
} as const

const ROOM_GAUGE_HELP = {
  goose_chess_ai_players: 'AI players currently retained in active rooms.',
  goose_chess_pending_commands: 'Authority commands currently queued or executing.',
  goose_chess_reconnecting_players: 'Remote players currently inside their reconnect grace period.',
  goose_chess_remote_players: 'Remote player seats currently retained in active rooms.',
  goose_chess_room_leases: 'Rooms currently held with an active local lease.',
  goose_chess_rooms: 'Rooms currently retained by status.',
  goose_chess_server_uptime_seconds: 'Game server process uptime in seconds.',
  goose_chess_store_connections: 'WebSocket subscriptions currently attached to room members.',
  goose_chess_ws_connections_current: 'Currently open WebSocket connections.',
} as const

function escapeLabel(value: string | number) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"')
}

function labelsKey(labels: MetricLabels) {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join('&')
}

function renderSeries(series: MetricSeries) {
  const labels = Object.entries(series.labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}="${escapeLabel(value)}"`)
    .join(',')
  return `${series.name}${labels ? `{${labels}}` : ''} ${series.value}`
}

export class GameServerMetrics {
  private readonly counters = new Map<string, MetricSeries>()
  private readonly startedAt: number
  private openSockets = 0

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now()
  }

  recordHttp(method: string, route: string, status: number, durationMs: number) {
    const labels = { method, route, status }
    this.increment('goose_chess_http_requests_total', labels)
    this.increment('goose_chess_http_request_duration_seconds_count', { method, route })
    this.increment('goose_chess_http_request_duration_seconds_sum', { method, route }, durationMs / 1_000)
  }

  recordProtocol(type: string, outcome: 'accepted' | 'invalid' | 'rejected' | 'error') {
    this.increment('goose_chess_protocol_messages_total', { type, outcome })
  }

  recordCommand(kind: 'authority' | 'lobby', outcome: 'accepted' | 'rejected' | 'error', code = 'ok') {
    this.increment('goose_chess_room_commands_total', { kind, outcome, code })
  }

  recordOwnership(type: 'acquired' | 'lost' | 'released' | 'renewed') {
    this.increment('goose_chess_room_ownership_events_total', { type })
  }

  recordRateLimit(scope: 'http' | 'websocket_message' | 'websocket_upgrade') {
    this.increment('goose_chess_rate_limit_rejections_total', { scope })
  }

  recordDiagnostic(event: string, severity: DiagnosticSeverity) {
    this.increment('goose_chess_diagnostics_total', { event, severity })
  }

  openSocket() {
    this.openSockets += 1
    this.increment('goose_chess_ws_connections_total', {})
  }

  closeSocket() {
    this.openSockets = Math.max(0, this.openSockets - 1)
  }

  render(rooms: RoomStoreDiagnostics) {
    const lines: string[] = []
    Object.entries(METRIC_HELP).forEach(([name, help]) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`)
      const matching = [...this.counters.values()]
        .filter((series) => series.name === name)
        .sort((left, right) => labelsKey(left.labels).localeCompare(labelsKey(right.labels)))
      matching.forEach((series) => lines.push(renderSeries(series)))
    })

    const gauges: MetricSeries[] = [
      { name: 'goose_chess_ws_connections_current', labels: {}, value: this.openSockets },
      { name: 'goose_chess_server_uptime_seconds', labels: {}, value: Math.max(0, (this.now() - this.startedAt) / 1_000) },
      { name: 'goose_chess_rooms', labels: { status: 'waiting' }, value: rooms.waitingRooms },
      { name: 'goose_chess_rooms', labels: { status: 'playing' }, value: rooms.playingRooms },
      { name: 'goose_chess_rooms', labels: { status: 'finished' }, value: rooms.finishedRooms },
      { name: 'goose_chess_room_leases', labels: {}, value: rooms.leasedRooms },
      { name: 'goose_chess_remote_players', labels: {}, value: rooms.remotePlayers },
      { name: 'goose_chess_ai_players', labels: {}, value: rooms.aiPlayers },
      { name: 'goose_chess_reconnecting_players', labels: {}, value: rooms.reconnectingPlayers },
      { name: 'goose_chess_store_connections', labels: {}, value: rooms.connections },
      { name: 'goose_chess_pending_commands', labels: {}, value: rooms.pendingCommands },
    ]
    Object.entries(ROOM_GAUGE_HELP).forEach(([name, help]) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`)
      gauges.filter((series) => series.name === name).forEach((series) => lines.push(renderSeries(series)))
    })
    return `${lines.join('\n')}\n`
  }

  private increment(name: string, labels: MetricLabels, amount = 1) {
    const key = `${name}|${labelsKey(labels)}`
    const current = this.counters.get(key) ?? { name, labels, value: 0 }
    current.value += amount
    this.counters.set(key, current)
  }
}

export type DiagnosticSeverity = 'error' | 'warning'

export interface DiagnosticEntry {
  readonly timestamp: string
  readonly severity: DiagnosticSeverity
  readonly event: string
  readonly requestId?: string
  readonly roomCode?: string
  readonly gameId?: string
  readonly commandId?: string
  readonly commandType?: string
  readonly errorCode?: string
  readonly errorName?: string
  readonly expectedRevision?: number
  readonly revision?: number
  readonly phase?: string
  readonly activePlayerId?: string | null
  readonly pendingCommands?: number
}

export type DiagnosticSink = (entry: DiagnosticEntry) => void

export const jsonConsoleDiagnosticSink: DiagnosticSink = (entry) => {
  console.error(JSON.stringify(entry))
}
