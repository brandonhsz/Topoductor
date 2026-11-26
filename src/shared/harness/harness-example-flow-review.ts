import type { HarnessAgentNode } from './harness-flow-types'
import { at } from './harness-example-flow-ideation'

const REVIEWER_RULES = `Eres un revisor adversarial: tu trabajo es romper el cambio, no aprobarlo. Otros revisores atacan otros ángulos en paralelo; quédate en el tuyo.
1. Obtén el diff completo del trabajo contra la rama base (\`git merge-base\` + \`git diff\`); si el workspace no es un repositorio git, revisa los archivos que mencionan el plan y la ejecución.
2. Cada hallazgo necesita evidencia: archivo y línea, cómo falla (entrada → resultado incorrecto) y, cuando puedas, un comando o prueba que lo demuestre. Corre lo que haga falta para confirmarlo.
3. Sin evidencia no hay hallazgo. No reportes estilo ni gustos.
4. Si recibes «correccion», es una ronda después de corregir hallazgos tuyos o de otros revisores: confirma que quedaron resueltos y revisa sobre todo lo que cambió en esa corrección.
Formato: tabla Hallazgo | Archivo:línea | Cómo falla | Evidencia | Severidad (alta/media/baja). Si no encontraste nada, dilo.`

function reviewer(id: string, title: string, angle: string, row: number): HarnessAgentNode {
  return {
    kind: 'agent',
    id,
    title,
    block: 'Interrogatorio',
    position: at(5, row),
    // Pick a different model per reviewer in the inspector; disagreement between models is the point.
    agent: null,
    reuseSession: true,
    // Reviewers and judge run on Topo so other models, and not the author, look at the diff.
    runner: 'topo',
    allowEdits: false,
    prompt: `${REVIEWER_RULES}\n\nTu ángulo: ${angle}`,
    inputs: ['intent', 'plan', 'ejecucion', 'correccion'],
    outputKey: id,
    joinAll: false,
    maxVisits: 4,
    limitTarget: null
  }
}

/** Before the PR, several reviewers try to break the final diff from different angles; a judge keeps what holds. */
export const REVIEW_NODES: HarnessAgentNode[] = [
  reviewer(
    'revisor_bugs',
    '🔎 Revisor: bugs y casos borde',
    'bugs de lógica, casos borde, entradas vacías o inválidas, manejo de errores y estados intermedios.',
    4.4
  ),
  reviewer(
    'revisor_regresiones',
    '🔎 Revisor: regresiones y concurrencia',
    'regresiones en lo que ya funcionaba, condiciones de carrera, orden de eventos, datos persistidos y compatibilidad con versiones anteriores.',
    5
  ),
  reviewer(
    'revisor_calidad',
    '🔎 Revisor: calidad y simplicidad',
    'código duplicado o que reimplementa algo existente, complejidad innecesaria, nombres engañosos y pruebas que no prueban nada.',
    5.6
  ),
  reviewer(
    'revisor_seguridad',
    '🔎 Revisor: seguridad y plataforma',
    'entradas no confiables, secretos, permisos, rutas y comandos de sistema, y diferencias entre macOS, Linux, Windows y hosts remotos.',
    6.2
  ),
  {
    kind: 'agent',
    id: 'juez',
    title: 'Juez del interrogatorio',
    block: 'Interrogatorio',
    position: at(6, 5.3),
    agent: null,
    reuseSession: true,
    runner: 'topo',
    allowEdits: false,
    prompt: `Recibes los hallazgos de varios revisores adversariales. Decide cuáles son reales.
1. Junta los duplicados.
2. Verifica cada hallazgo contra el código y, si hace falta, corre su evidencia. No aceptes un hallazgo solo porque varios revisores lo dijeron.
3. Marca cada uno como confirmado o descartado, con el motivo en una línea.
Formato: tabla Hallazgo | Revisores | Veredicto | Motivo. Los confirmados pasan a corrección como hallazgos nuevos.`,
    inputs: ['revisor_bugs', 'revisor_regresiones', 'revisor_calidad', 'revisor_seguridad'],
    outputKey: 'interrogatorio',
    joinAll: true,
    maxVisits: 4,
    limitTarget: null
  }
]
