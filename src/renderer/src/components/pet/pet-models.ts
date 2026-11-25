import claudeUrl from '../../../../../resources/claude.webp?url'
import opencodeUrl from '../../../../../resources/opencode.webp?url'
import gremlinUrl from '../../../../../resources/gremlin.webp?url'
import topoUrl from '../../../../../resources/topo.webp?url'
import { translate } from '@/i18n/i18n'
import type { CustomPet } from '../../../../shared/pet-types'
import {
  CODEX_PET_ANIMATIONS,
  CODEX_PET_DEFAULT_ANIMATION,
  CODEX_PET_DEFAULT_COLUMNS,
  CODEX_PET_DEFAULT_FPS,
  CODEX_PET_FRAME
} from '../../../../shared/codex-pet-sprite-defaults'

export const TOPO_PET_ID = 'topo-the-miner'
export const CLAUDE_PET_ID = 'claude-the-mage'
export const DEFAULT_PET_ID = TOPO_PET_ID
export const OPENCODE_PET_ID = 'opencode-the-rogue'
export const GREMLIN_PET_ID = 'gremlin-the-trickster'

export type BundledPetId =
  | typeof TOPO_PET_ID
  | typeof CLAUDE_PET_ID
  | typeof OPENCODE_PET_ID
  | typeof GREMLIN_PET_ID

export type BundledPet = {
  id: BundledPetId
  label: string
  url: string
  /** Codex-layout sheet; absent means `url` is a self-animating image. */
  sprite?: NonNullable<CustomPet['sprite']>
}

const TOPO_SHEET_ROWS = 9

export const BUNDLED_PETS: readonly BundledPet[] = [
  {
    id: TOPO_PET_ID,
    get label() {
      return translate('auto.components.pet.pet.models.7d658dd64d', 'Topo')
    },
    url: topoUrl,
    sprite: {
      frameWidth: CODEX_PET_FRAME.width,
      frameHeight: CODEX_PET_FRAME.height,
      columns: CODEX_PET_DEFAULT_COLUMNS,
      rows: TOPO_SHEET_ROWS,
      sheetWidth: CODEX_PET_FRAME.width * CODEX_PET_DEFAULT_COLUMNS,
      sheetHeight: CODEX_PET_FRAME.height * TOPO_SHEET_ROWS,
      fps: CODEX_PET_DEFAULT_FPS,
      defaultAnimation: CODEX_PET_DEFAULT_ANIMATION,
      animations: CODEX_PET_ANIMATIONS
    }
  },
  {
    id: CLAUDE_PET_ID,
    get label() {
      return translate('auto.components.pet.pet.models.2528586aa7', 'Claudino')
    },
    url: claudeUrl
  },
  {
    id: OPENCODE_PET_ID,
    get label() {
      return translate('auto.components.pet.pet.models.a84d5677ff', 'OpenCode')
    },
    url: opencodeUrl
  },
  {
    id: GREMLIN_PET_ID,
    get label() {
      return translate('auto.components.pet.pet.models.7433516faf', 'Gremlin')
    },
    url: gremlinUrl
  }
] as const

export const BUNDLED_PET: BundledPet = BUNDLED_PETS[0]

export function isBundledPetId(id: string | undefined): boolean {
  return BUNDLED_PETS.some((s) => s.id === id)
}

export function findBundledPet(id: string | undefined): BundledPet | undefined {
  return BUNDLED_PETS.find((s) => s.id === id)
}
