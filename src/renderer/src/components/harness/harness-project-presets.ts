import type {
  HarnessFlow,
  HarnessProjectProfile
} from '../../../../shared/harness/harness-flow-types'

/** Topo's own layout and checks, from AGENTS.md; a starting point for a Topo repo override. */
const TOPO_PROJECT: HarnessProjectProfile = {
  appCommand: 'TOPO_BACKGROUND_LAUNCH=1 pnpm dev',
  appUrl: '',
  testCommand: 'pnpm tc && pnpm lint',
  evidenceTool:
    'Componentes: un *.fixture.tsx junto al componente y `pnpm fixtures:shot <id> --theme both` (PNGs en .cache/fixtures/). App completa: Electron con TOPO_BACKGROUND_LAUNCH=1 y capturas por Playwright CDP de la ventana oculta; nunca robar el foco ni mostrar ventanas.',
  notes:
    'Sigue AGENTS.md y docs/STYLEGUIDE.md (tokens de main.css y primitivas de components/ui). Todo cambio debe funcionar en macOS, Linux y Windows, en hosts remotos y en workspaces de carpeta (no asumir git). Antes de cada push corre `pnpm check:changed`; nunca `--no-verify`.',
  prMode: 'single'
}

const TOPO_ROLE_PATHS: Record<string, string[]> = {
  pruebas: ['**/*.test.ts', '**/*.test.tsx', 'config/vitest.config.ts'],
  visual: [
    'src/renderer/src/components',
    'src/renderer/src/assets',
    'src/renderer/src/i18n/locales'
  ],
  lógica: ['src/main', 'src/preload', 'src/shared', 'src/renderer/src/store']
}

export function applyTopoPreset(flow: HarnessFlow): HarnessFlow {
  return {
    ...flow,
    project: { ...TOPO_PROJECT, prMode: flow.project.prMode },
    nodes: flow.nodes.map((node) =>
      node.kind === 'waves'
        ? {
            ...node,
            roles: node.roles.map((role) => ({
              ...role,
              paths: TOPO_ROLE_PATHS[role.name.toLowerCase()] ?? role.paths
            }))
          }
        : node
    )
  }
}
