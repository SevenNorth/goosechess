import { DeterministicRandom } from '@goose-chess/game-core'
import { createGooseAiStrategy, AiTurnController } from '@goose-chess/game-ai'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
import { OFFLINE_MATCH_MODES, createOfflineMatch } from '@goose-chess/game-protocol'

function readArguments(argv) {
  const values = new Map()
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) {
      positional.push(argument)
      continue
    }
    const [key, inlineValue] = argument.slice(2).split('=', 2)
    const value = inlineValue ?? argv[index + 1]
    if (inlineValue === undefined) index += 1
    values.set(key, value)
  }
  const mode = values.get('mode') ?? positional[0] ?? process.env.npm_config_mode ?? '1v1'
  const games = Number(values.get('games') ?? positional[1] ?? process.env.npm_config_games ?? 1000)
  const seedStart = Number(values.get('seed-start') ?? positional[2] ?? process.env.npm_config_seed_start ?? 1)
  const maxRounds = Number(values.get('max-rounds') ?? positional[3] ?? process.env.npm_config_max_rounds ?? 500)
  if (!OFFLINE_MATCH_MODES.includes(mode)) throw new RangeError(`--mode must be one of: ${OFFLINE_MATCH_MODES.join(', ')}`)
  if (!Number.isInteger(games) || games < 1) throw new RangeError('--games must be a positive integer.')
  if (!Number.isInteger(seedStart) || seedStart < 0) throw new RangeError('--seed-start must be a non-negative integer.')
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new RangeError('--max-rounds must be a positive integer.')
  return { mode, games, seedStart, maxRounds }
}

function hashPlayerId(playerId) {
  let hash = 2166136261
  for (const character of playerId) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function decisionRandom(matchSeed, view) {
  const seed = (matchSeed ^ Math.imul(view.revision + 1, 0x9e3779b1) ^ hashPlayerId(view.viewerPlayerId)) >>> 0
  return new DeterministicRandom({ seed, cursor: 0 })
}

function nextDecisionPlayer(snapshot) {
  if (snapshot.state.phase === 'setup') {
    return snapshot.state.players.find((player) => player.itemId === null)?.playerId ?? null
  }
  return snapshot.state.phase === 'game-over' ? null : snapshot.state.activePlayerId
}

async function simulateGame(mode, seed, maxRounds) {
  const match = createOfflineMatch({ mode, gameId: `simulation-${mode}-${seed}`, seed }, DEFAULT_GAME_DEFINITION)
  const aiController = new AiTurnController(
    createGooseAiStrategy(),
    match.controller,
    (view) => decisionRandom(seed, view),
  )
  const eventFrequency = new Map()
  let commandCount = 0
  const maxCommands = maxRounds * match.participants.length * 6

  for (;;) {
    const snapshot = match.authority.getSnapshot()
    if (snapshot.state.phase === 'game-over') {
      return {
        completed: true,
        rounds: snapshot.state.round,
        winnerPlayerId: snapshot.state.winnerPlayerId,
        eventFrequency,
        commandCount,
      }
    }
    if (snapshot.state.round > maxRounds) throw new Error(`max-round breach at round ${snapshot.state.round}`)
    if (commandCount >= maxCommands) throw new Error(`command limit exceeded at revision ${snapshot.revision}`)

    const playerId = nextDecisionPlayer(snapshot)
    if (!playerId) throw new Error(`no decision player for phase ${snapshot.state.phase}`)
    const turn = await aiController.takeTurn(match.authority.getDecisionView(playerId))
    if (!turn) throw new Error(`deadlock: ${playerId} has no legal command during ${snapshot.state.phase}`)
    if (!turn.result.ok) throw new Error(`illegal command: ${turn.result.error.code}: ${turn.result.error.message}`)
    commandCount += 1
    for (const event of turn.result.update.events) {
      if (event.type === 'event-resolved') {
        eventFrequency.set(event.eventCardId, (eventFrequency.get(event.eventCardId) ?? 0) + 1)
      }
    }
  }
}

async function runSimulation(options) {
  const wins = new Map()
  const eventFrequency = new Map()
  const abnormalTerminations = new Map()
  let completed = 0
  let totalRounds = 0

  for (let index = 0; index < options.games; index += 1) {
    const seed = options.seedStart + index
    try {
      const result = await simulateGame(options.mode, seed, options.maxRounds)
      completed += 1
      totalRounds += result.rounds
      wins.set(result.winnerPlayerId, (wins.get(result.winnerPlayerId) ?? 0) + 1)
      for (const [eventId, count] of result.eventFrequency) {
        eventFrequency.set(eventId, (eventFrequency.get(eventId) ?? 0) + count)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      abnormalTerminations.set(reason, (abnormalTerminations.get(reason) ?? 0) + 1)
    }
  }

  const report = {
    mode: options.mode,
    seedRange: [options.seedStart, options.seedStart + options.games - 1],
    games: options.games,
    completed,
    completionRate: completed / options.games,
    averageRounds: completed ? Number((totalRounds / completed).toFixed(3)) : null,
    wins: Object.fromEntries([...wins.entries()].sort()),
    eventFrequency: Object.fromEntries([...eventFrequency.entries()].sort()),
    abnormalTerminations: Object.fromEntries([...abnormalTerminations.entries()].sort()),
  }
  console.log(JSON.stringify(report, null, 2))
  if (completed !== options.games || abnormalTerminations.size) process.exitCode = 1
}

await runSimulation(readArguments(process.argv.slice(2)))
