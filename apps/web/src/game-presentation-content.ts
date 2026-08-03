import {
  Dices,
  Footprints,
  PackageOpen,
  Shield,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'

export const COLOR_HEX: Readonly<Record<string, string>> = {
  pink: '#e82f73',
  blue: '#3977c5',
  gold: '#d4a43a',
  teal: '#2baf9c',
}

export const ITEM_COPY: Readonly<Record<string, { icon: LucideIcon; description: string }>> = {
  boots: { icon: Footprints, description: '使用后，本次移动额外前进 3 格。' },
  clover: { icon: Sparkles, description: '下一次骰子检定必定成功。' },
  cat: { icon: Shield, description: '自动抵消下一次被撞回效果。' },
  barnacle: { icon: PackageOpen, description: '选择一名对手，使其立即后退 2 格。' },
  duckling: { icon: PackageOpen, description: '立即来到拾荒沙滩。' },
  compass: { icon: Dices, description: '本回合移动点数固定为 8。' },
  tea: { icon: PackageOpen, description: '选择一名对手，使其下一回合每颗骰子最多为 3。' },
  umbrella: { icon: Shield, description: '自动抵消下一次暂停回合效果。' },
  'lucky-coin': { icon: Sparkles, description: '下一次骰子检定必定成功。' },
  'spring-shoes': { icon: Footprints, description: '使用后，本次移动额外前进 3 格。' },
  'driftwood-shield': { icon: Shield, description: '自动抵消下一次被撞回效果。' },
  'warm-soup': { icon: Shield, description: '自动抵消下一次暂停回合效果。' },
}

export function eventById(eventId: string) {
  return DEFAULT_GAME_DEFINITION.events.find((event) => event.id === eventId)
}

export function itemById(itemId: string | null | undefined) {
  return itemId ? DEFAULT_GAME_DEFINITION.items.find((item) => item.id === itemId) : undefined
}
