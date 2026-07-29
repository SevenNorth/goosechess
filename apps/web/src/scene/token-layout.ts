export interface TokenPosition {
  readonly playerId: string
  readonly seatIndex: number
  readonly spaceId: number
}

export function tokenOffset(player: TokenPosition, players: readonly TokenPosition[]) {
  const occupants = players
    .filter((candidate) => candidate.spaceId === player.spaceId)
    .sort((left, right) => left.seatIndex - right.seatIndex)
  if (occupants.length <= 1) return { x: 0, y: 0 }

  const index = occupants.findIndex((candidate) => candidate.playerId === player.playerId)
  if (occupants.length === 2) return { x: index === 0 ? -18 : 18, y: 0 }
  return { x: (index % 2) * 38 - 19, y: Math.floor(index / 2) * 28 - 14 }
}
