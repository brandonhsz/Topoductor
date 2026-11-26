import {
  HARNESS_FLOW_SCHEMA_VERSION,
  type HarnessAgentNode,
  type HarnessEdge,
  type HarnessFlow,
  type HarnessNode
} from './harness-flow-types'
import { DELIVERY_NODES } from './harness-example-flow-delivery'
import { at } from './harness-example-flow-ideation'
import { REVIEW_NODES } from './harness-example-flow-review'
import { EMPTY_HARNESS_PROJECT } from './harness-flow-normalize'

export const HARNESS_TICKET_FLOW_ID = 'avenapm-ticket'
/** Bump when the flow changes so unedited copies upgrade. */
export const HARNESS_TICKET_FLOW_VERSION = 2

const SHARED_INSTRUCTIONS = `Trabajas dentro de un flujo de Topo que resuelve un ticket de la cola de operación de Avena (Squads, tickets OP-xxx) sin ninguna persona hasta el PR. Topo lanza un agente por nodo, le pasa el contexto y decide el siguiente nodo con tu respuesta final.

- Haz solo el trabajo de tu nodo. No adelantes trabajo de otros nodos.
- Nadie va a contestar preguntas durante la corrida. Si te falta información, el ticket pide una decisión de producto o de gusto que no está escrita, o el cambio es riesgoso (datos de producción, pagos, permisos, migraciones), elige la salida que escala. Nunca adivines.
- Prototipa en vez de suponer: si una duda se responde observando algo (cómo se ve, si funciona, rendimiento), haz una prueba desechable y deja que el resultado decida.
- Reporta con honestidad: si algo falla, muestra la salida real.
- Reglas de la cola: el título del PR empieza con el ID del ticket; la descripción dice «Cierra OP-xxx» si lo arregla o «Ref OP-xxx» si es solo una parte; cada commit termina con «Ref OP-xxx». Nunca uses \`validar_ticket\` ni pases un ticket a «Terminado»: eso lo hace soporte al validar en producción.
- No modifiques CLAUDE.md ni AGENTS.md del repositorio.`

const ESCALATION = 'escalado'

function edge(source: string, target: string, label = ''): HarnessEdge {
  return { id: `${source}--${target}`, source, target, label, when: null }
}

function agentNode(
  node: Pick<HarnessAgentNode, 'id' | 'title' | 'block' | 'position' | 'prompt' | 'inputs'> &
    Partial<HarnessAgentNode>
): HarnessAgentNode {
  return {
    kind: 'agent',
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: false,
    outputKey: node.id,
    joinAll: false,
    maxVisits: 3,
    limitTarget: ESCALATION,
    ...node
  }
}

type ReusePatch = Pick<HarnessAgentNode, 'position'> &
  Partial<Pick<HarnessAgentNode, 'block' | 'inputs' | 'freshInputs' | 'maxVisits' | 'limitTarget'>>

/** A node of the delivery flow with ticket inputs and placement; every loop escalates instead of asking. */
function reused(id: string, patch: ReusePatch): HarnessNode {
  const node = [...DELIVERY_NODES, ...REVIEW_NODES].find((candidate) => candidate.id === id)
  if (!node || node.kind === 'start' || node.kind === 'end') {
    throw new Error(`Harness ticket flow: missing delivery step ${id}`)
  }
  return { ...node, ...patch }
}

const TICKET_NODES: HarnessNode[] = [
  {
    kind: 'start',
    id: 'ticket',
    title: 'Ticket',
    block: 'Entrada',
    position: at(0, 0),
    fields: [
      { key: 'ticket', label: 'ID corto del ticket (p. ej. OP-142)', options: [], optional: false },
      {
        key: 'correo',
        label: 'Correo con el que se toma el ticket',
        options: [],
        optional: false
      },
      {
        key: 'nota',
        label: 'Nota para los agentes (opcional)',
        options: [],
        optional: true
      }
    ]
  },
  agentNode({
    id: 'tomar',
    title: 'Tomar y clasificar',
    block: 'Entrada',
    position: at(1, 0),
    inputs: ['ticket', 'correo', 'nota'],
    outputKey: 'ficha',
    prompt: `Toma el ticket y decide qué ruta sigue. No escribas código.
1. Lee el ticket con \`leer_ticket\` y su ID corto. Si la herramienta no está disponible o el ticket no existe, elige "No es para agentes".
2. Llama \`empezar_ticket\` con el ID corto y el correo antes de cualquier otro trabajo.
3. Lee el proyecto lo necesario para ubicar dónde vive el problema.
4. Clasifica:
   - Bug: algo que funcionaba o debería funcionar y falla.
   - Mejora: un cambio de comportamiento o de UI que el ticket describe con suficiente detalle para construirlo sin inventar decisiones de producto.
   - Sin código: se resuelve con una respuesta, una investigación o una configuración que no toca el repositorio.
   - No es para agentes: falta información, pertenece a otro repositorio, pide una decisión de producto que el ticket no toma, o toca datos de producción, pagos o permisos.

Entrega la ficha:
### Ficha OP-xxx
**Título:** ...   **Tipo:** bug | mejora | sin código
**Qué pide (en palabras del ticket):** ...
**Criterios de aceptación:** lista verificable; si el ticket no los trae, dedúcelos solo de lo que dice.
**Dónde vive:** archivos y capas reales.
**Riesgos:** ...`
  }),
  reused('reproduccion', {
    position: at(2, -1),
    block: 'Ruta: bug',
    inputs: ['ficha', 'nota'],
    limitTarget: ESCALATION
  }),
  agentNode({
    id: 'especificacion',
    title: 'Especificación',
    block: 'Ruta: mejora',
    position: at(2, 1),
    inputs: ['ficha', 'nota', 'revision_especificacion'],
    freshInputs: ['revision_especificacion'],
    outputKey: 'consolidada',
    prompt: `Convierte la ficha en la especificación que se va a construir. No escribas código.
- Elige siempre la versión más pequeña que cumple todos los criterios del ticket. Lo que el ticket no pide queda fuera.
- Si una decisión de producto o de gusto no está en el ticket, no la tomes: lístala en "Decisiones que faltan".
- Si recibes «revision_especificacion», corrige lo que señala.

### Especificación
**Qué cambia para quien lo usa:** ...
**Criterios de aceptación:** (los del ticket, verificables uno por uno)
**Fuera de alcance:** ...
**Decisiones que faltan:** ninguna | lista`
  }),
  agentNode({
    id: 'revision_especificacion',
    title: 'Revisión de la especificación',
    block: 'Ruta: mejora',
    position: at(3, 1),
    runner: 'topo',
    inputs: ['ficha', 'consolidada'],
    prompt: `Revisa la especificación como lo haría quien abrió el ticket. No la reescribas.
- ¿Cubre cada criterio del ticket? ¿Agrega algo que el ticket no pidió?
- ¿Toma alguna decisión de producto o de gusto que el ticket no tomó?
- ¿"Decisiones que faltan" está vacío de verdad?
Elige "Lista" solo si no hay nada que corregir y no falta ninguna decisión. Si falta una decisión que solo una persona puede tomar, elige "Necesita una persona".`
  }),
  agentNode({
    id: 'sin_codigo',
    title: 'Resolver sin código',
    block: 'Ruta: sin código',
    position: at(2, 2.2),
    allowEdits: true,
    inputs: ['ficha', 'nota'],
    prompt: `Resuelve el ticket sin cambiar el producto: responde con evidencia (código leído, comandos, salidas, mediciones). No dejes cambios en el workspace; si creaste prototipos, bórralos.
No ejecutes acciones con efecto fuera del workspace (datos de producción, configuraciones compartidas, pagos, permisos): si el ticket las necesita, elige "Necesita una persona" y describe exactamente qué hay que hacer.
Entrega: la respuesta en 3 a 5 líneas, la evidencia y la solución en una o dos líneas (qué se hizo en lugar de código).`
  }),
  reused('plan', {
    position: at(4, 0),
    inputs: ['ficha', 'consolidada', 'reproduccion', 'revision_plan', 'plan_problemas'],
    freshInputs: ['revision_plan', 'plan_problemas'],
    maxVisits: 4,
    limitTarget: ESCALATION
  }),
  agentNode({
    id: 'revision_plan',
    title: 'Revisión del plan',
    block: 'Plan',
    position: at(5, 0),
    runner: 'topo',
    inputs: ['ficha', 'consolidada', 'reproduccion', 'plan'],
    prompt: `Toma el lugar de la persona que aprueba el plan. Léelo contra el código real, no solo contra el texto.
- ¿Cada criterio del ticket tiene al menos una tarea que lo cumple y una prueba que lo verifica?
- ¿Es el cambio más pequeño posible? Señala tareas que sobran.
- ¿Respeta las reglas de oleadas: contrato primero, pruebas en rojo marcadas con "red", dos tareas de la misma oleada sin archivos compartidos, dependencias solo hacia oleadas anteriores?
- ¿Toca algo riesgoso (datos de producción, pagos, permisos, migraciones) que el ticket no autoriza?
Si pides ajustes, dilos como una lista concreta. Elige "Fuera de alcance" si el plan correcto sería mucho más grande que lo que pide el ticket o necesita una decisión de una persona.`
  }),
  reused('ejecucion', { position: at(6, 0), maxVisits: 3, limitTarget: ESCALATION }),
  reused('analisis', {
    position: at(7, 0),
    inputs: ['ficha', 'consolidada', 'reproduccion', 'plan', 'ejecucion', 'correccion'],
    limitTarget: ESCALATION
  }),
  reused('correccion', { position: at(7, 1.2) }),
  ...REVIEW_NODES.map((node, index) =>
    reused(node.id, {
      position: node.id === 'juez' ? at(9, 0) : at(8, index - 1.5),
      inputs: node.id === 'juez' ? node.inputs : ['ficha', 'plan', 'ejecucion', 'correccion'],
      limitTarget: ESCALATION
    })
  ),
  agentNode({
    id: 'abrir_pr',
    title: 'Abrir PR',
    block: 'Entrega',
    position: at(10, 0),
    allowEdits: true,
    inputs: ['ticket', 'ficha', 'consolidada', 'reproduccion', 'ejecucion', 'analisis'],
    outputKey: 'pr',
    prompt: `Publica el trabajo para revisión siguiendo las reglas del repositorio (nombre de rama, formato de commits, checks previos al push) y las de la cola.
- Revisa que no queden cambios sin commit y que los checks pasen. Nunca te saltes los hooks.
- Cada commit termina con «Ref <ID>».
- Título del PR: empieza con el ID del ticket. Descripción: «Cierra <ID>», qué se cambió, cómo se verificó y las rutas de las evidencias del análisis (y de la reproducción, si es un bug).
- Mira el modo de PR en la sección Proyecto; con PRs apilados, los de cada oleada ya se abrieron: sube la corrección final encima de la pila.
Responde con los enlaces. Si algo lo impide (sin remoto, checks rotos, sin permisos), elige "Bloqueado" con la salida real.`
  }),
  agentNode({
    id: 'reportar',
    title: 'Reportar en el ticket',
    block: 'Entrega',
    position: at(11, 0),
    inputs: ['ticket', 'correo', 'ficha', 'reproduccion', 'analisis', 'sin_codigo', 'pr'],
    outputKey: 'reporte',
    prompt: `Deja el ticket listo para quien sigue.
- Escribe la solución en una o dos líneas: cuál fue la causa y qué se cambió (o, sin código, qué se hizo en su lugar). Regístrala con \`reportar_solucion\`.
- Si hubo PR: comenta el ticket con \`comentar_ticket\` con el enlace y cómo verificarlo. No muevas el ticket de estado: lo mueve el merge o quien despliega.
- Si se resolvió sin código: pásalo a «En revisión» con \`cerrar_tarea\`, incluyendo la solución en el campo \`solucion\`.
- Nunca uses \`validar_ticket\`.
Entrega la solución registrada y lo que quedó en el ticket.`
  }),
  agentNode({
    id: ESCALATION,
    title: 'Escalar en el ticket',
    block: 'Escalado',
    position: at(6, 2.4),
    // Waits inside the escalation node go to a person; escalating to itself would loop.
    maxVisits: 10,
    limitTarget: null,
    inputs: ['ticket', 'correo', 'ficha', 'motivo_escalado', 'historial', 'correccion', 'pr'],
    prompt: `La corrida no puede seguir sin una persona. Deja el ticket en un estado que cualquiera pueda retomar.
1. Comenta el ticket con \`comentar_ticket\`: qué se vio, qué se intentó (con la evidencia), por qué se detuvo (ver «motivo_escalado» y el historial) y qué falta exactamente.
2. Si lo que falta es una respuesta o una decisión de una persona, usa \`pausar_ticket\`.
3. Si quedaron cambios útiles en el workspace, haz commit en la rama de trabajo con «Ref <ID>» y di cuál es; no abras PR.
Entrega lo que quedó en el ticket.`
  }),
  { kind: 'end', id: 'entregado', title: 'Entregado', block: 'Entrega', position: at(12, 0) },
  { kind: 'end', id: 'pausado', title: 'Pausado', block: 'Escalado', position: at(7, 2.4) }
]

const ESCALATE = 'Necesita una persona'
const REVIEWERS = REVIEW_NODES.filter((node) => node.id !== 'juez').map((node) => node.id)

const edges: HarnessEdge[] = [
  edge('ticket', 'tomar'),
  edge('tomar', 'reproduccion', 'Bug'),
  edge('tomar', 'especificacion', 'Mejora'),
  edge('tomar', 'sin_codigo', 'Sin código'),
  edge('tomar', ESCALATION, 'No es para agentes'),
  edge('reproduccion', 'plan', 'Reproducido'),
  edge('reproduccion', ESCALATION, 'No se reproduce'),
  edge('especificacion', 'revision_especificacion'),
  edge('revision_especificacion', 'plan', 'Lista'),
  edge('revision_especificacion', 'especificacion', 'Ajustar'),
  edge('revision_especificacion', ESCALATION, ESCALATE),
  edge('sin_codigo', 'reportar', 'Resuelto sin código'),
  edge('sin_codigo', ESCALATION, ESCALATE),
  edge('plan', 'revision_plan'),
  edge('revision_plan', 'ejecucion', 'Aprobado'),
  edge('revision_plan', 'plan', 'Ajustes'),
  edge('revision_plan', ESCALATION, 'Fuera de alcance'),
  edge('ejecucion', 'analisis'),
  edge('analisis', 'revisor_bugs', 'Todo cumple'),
  edge('analisis', 'revisor_regresiones', 'Todo cumple'),
  edge('analisis', 'revisor_calidad', 'Todo cumple'),
  edge('analisis', 'revisor_seguridad', 'Todo cumple'),
  edge('analisis', 'correccion', 'Hay hallazgos'),
  edge('correccion', 'analisis', 'Resuelto'),
  ...REVIEWERS.map((reviewer) => edge('correccion', reviewer, 'Resuelto: interrogatorio')),
  edge('correccion', 'correccion', 'Otro intento'),
  edge('correccion', ESCALATION, ESCALATE),
  edge('revisor_bugs', 'juez'),
  edge('revisor_regresiones', 'juez'),
  edge('revisor_calidad', 'juez'),
  edge('revisor_seguridad', 'juez'),
  edge('juez', 'correccion', 'Hay hallazgos confirmados'),
  edge('juez', 'abrir_pr', 'Sin hallazgos confirmados'),
  edge('abrir_pr', 'reportar', 'PR abierto'),
  edge('abrir_pr', ESCALATION, 'Bloqueado'),
  edge('reportar', 'entregado'),
  edge(ESCALATION, 'pausado')
]

export function createHarnessTicketFlow(now: number): HarnessFlow {
  return {
    schemaVersion: HARNESS_FLOW_SCHEMA_VERSION,
    id: HARNESS_TICKET_FLOW_ID,
    name: 'Ticket automático (Avena PM)',
    description:
      'Toma un ticket OP-xxx de la cola y lo lleva sin personas hasta el PR: clasificación → reproducción o especificación revisada → plan revisado → oleadas TDD → análisis con evidencias → interrogatorio → PR → solución en el ticket. Lo que se atora se comenta y se pausa en el ticket.',
    scope: { kind: 'global' },
    basedOnFlowId: null,
    defaultAgent: 'claude',
    sharedInstructions: SHARED_INSTRUCTIONS,
    project: EMPTY_HARNESS_PROJECT,
    escalationNode: ESCALATION,
    nodes: TICKET_NODES,
    edges,
    updatedAt: now
  }
}
