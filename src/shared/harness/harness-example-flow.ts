import {
  HARNESS_FLOW_SCHEMA_VERSION,
  type HarnessEdge,
  type HarnessEdgeCondition,
  type HarnessFlow
} from './harness-flow-types'
import { DELIVERY_NODES } from './harness-example-flow-delivery'
import { IDEATION_NODES } from './harness-example-flow-ideation'
import { REVIEW_NODES } from './harness-example-flow-review'
import { EMPTY_HARNESS_PROJECT } from './harness-flow-normalize'

export const HARNESS_EXAMPLE_FLOW_ID = 'intent-to-delivery'
/** Bump when the example changes so unedited copies upgrade. */
export const HARNESS_EXAMPLE_FLOW_VERSION = 8

const SHARED_INSTRUCTIONS = `Trabajas dentro de un flujo de desarrollo agéntico dirigido por Topo. Topo lanza un agente por nodo, le pasa el contexto y decide el siguiente nodo con tu respuesta final.

- Haz solo el trabajo de tu nodo. No adelantes trabajo de otros nodos.
- Si te falta información de fondo, dilo en tu respuesta en lugar de inventarla.
- Reporta con honestidad: si algo falla, muestra la salida real.
- Prototipa en vez de preguntar: si una duda se responde observando algo (cómo se ve, si funciona, rendimiento, layout), haz una prueba o prototipo desechable y deja que el resultado decida. A la persona solo se le preguntan decisiones de producto o de gusto.
- No modifiques CLAUDE.md ni AGENTS.md del repositorio.`

function edge(
  source: string,
  target: string,
  label = '',
  when: HarnessEdgeCondition | null = null
): HarnessEdge {
  return { id: `${source}--${target}`, source, target, label, when }
}

function tipo(value: string): HarnessEdgeCondition {
  return { key: 'tipo', op: 'eq', value }
}

const REVIEWERS = ['revisor_bugs', 'revisor_regresiones', 'revisor_calidad', 'revisor_seguridad']

const edges: HarnessEdge[] = [
  // Router: each kind of task takes the shortest branch that still proves the result.
  edge('intent', 'idea', '', tipo('feature')),
  edge('intent', 'reproduccion', '', tipo('bug')),
  edge('intent', 'plan', '', tipo('refactor')),
  edge('intent', 'investigacion', '', tipo('investigacion')),
  edge('investigacion', 'entregado'),
  edge('idea', 'usabilidad'),
  edge('idea', 'ingeniero'),
  edge('idea', 'viabilidad'),
  edge('usabilidad', 'sintesis'),
  edge('ingeniero', 'sintesis'),
  edge('viabilidad', 'sintesis'),
  edge('sintesis', 'respuesta'),
  edge('respuesta', 'idea', 'Quedan dudas abiertas'),
  edge('respuesta', 'intent', 'La intención cambió'),
  edge('respuesta', 'consolidada', 'Idea consolidada'),
  edge('consolidada', 'plan'),
  edge('plan', 'aprobacion'),
  edge('aprobacion', 'plan', 'Ajustes'),
  edge('aprobacion', 'idea', 'Idea incompleta'),
  edge('aprobacion', 'ejecucion', 'Aprobada'),
  edge('reproduccion', 'plan', 'Reproducido'),
  edge('reproduccion', 'idea', 'No se reproduce'),
  edge('ejecucion', 'analisis'),
  edge('analisis', 'evidencia_final', 'Todo cumple'),
  edge('analisis', 'correccion', 'Hay hallazgos'),
  edge('analisis', 'idea', 'La idea no era lo que se quería'),
  edge('correccion', 'analisis', 'Resuelto'),
  // Fixes of confirmed review findings go back to the reviewers, not through analysis and the video again.
  ...REVIEWERS.map((reviewer) => edge('correccion', reviewer, 'Resuelto: interrogatorio')),
  edge('correccion', 'correccion', 'Otro intento'),
  edge('correccion', 'idea', 'Problema de la idea'),
  edge('escalado', 'correccion', 'Reintentar'),
  edge('escalado', 'evidencia_final', 'Aceptar pendientes'),
  edge('escalado', 'idea', 'Revisar la idea'),
  edge('evidencia_final', 'revisor_bugs'),
  edge('evidencia_final', 'revisor_regresiones'),
  edge('evidencia_final', 'revisor_calidad'),
  edge('evidencia_final', 'revisor_seguridad'),
  edge('revisor_bugs', 'juez'),
  edge('revisor_regresiones', 'juez'),
  edge('revisor_calidad', 'juez'),
  edge('revisor_seguridad', 'juez'),
  edge('juez', 'correccion', 'Hay hallazgos confirmados'),
  edge('juez', 'abrir_pr', 'Sin hallazgos confirmados'),
  edge('abrir_pr', 'aprendizajes'),
  edge('aprendizajes', 'aplicar_aprendizajes'),
  edge('aplicar_aprendizajes', 'implementar_aprendizajes', 'Aplicar en el repo'),
  edge('aplicar_aprendizajes', 'entregado', 'Solo registrar'),
  edge('implementar_aprendizajes', 'entregado')
]

export function createHarnessExampleFlow(now: number): HarnessFlow {
  return {
    schemaVersion: HARNESS_FLOW_SCHEMA_VERSION,
    id: HARNESS_EXAMPLE_FLOW_ID,
    name: 'De la intención a la entrega',
    description:
      'Router por tipo → mesa de diálogo → plan por oleadas → ejecución TDD → análisis con evidencias → corrección → video final → interrogatorio → PR → aprendizajes.',
    scope: { kind: 'global' },
    basedOnFlowId: null,
    defaultAgent: 'claude',
    sharedInstructions: SHARED_INSTRUCTIONS,
    project: EMPTY_HARNESS_PROJECT,
    nodes: [...IDEATION_NODES, ...DELIVERY_NODES, ...REVIEW_NODES],
    edges,
    updatedAt: now
  }
}
