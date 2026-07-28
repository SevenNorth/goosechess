import type { DecisionView, JsonValue } from '@goose-chess/game-core'

export interface AiDecision<TCommand extends JsonValue> {
  readonly command: TCommand
  readonly reasonTag: string
}

export interface AiStrategy<TCommand extends JsonValue> {
  decide(view: DecisionView<TCommand>): AiDecision<TCommand> | null
}

export function createFirstLegalStrategy<TCommand extends JsonValue>(): AiStrategy<TCommand> {
  return {
    decide(view) {
      const option = view.legalOptions[0]
      if (!option) return null
      return {
        command: option.command,
        reasonTag: option.reasonTags[0] ?? 'first-legal-option',
      }
    },
  }
}
