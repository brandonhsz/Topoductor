import type { HarnessNode, HarnessPosition } from './harness-flow-types'

const COL = 300
const ROW = 170

export function at(col: number, row: number): HarnessPosition {
  return { x: col * COL, y: row * ROW }
}

const MESA_RULES = `Recibes el Intent, la última Idea (vN) y las respuestas que el usuario dio en rondas anteriores.
Devuelve máximo 3 preguntas o cuestionamientos, concretos y priorizados. No propongas soluciones: solo cuestiona. No escribas código de producción.
Si una duda tuya se responde observando algo (cómo se ve, si funciona, rendimiento), no se la preguntes a la persona: haz una sonda o prototipo desechable, reporta lo que viste y marca la duda como resuelta.`

/** Bloque 1: from the intent to a consolidated idea, through a parallel review table. */
export const IDEATION_NODES: HarnessNode[] = [
  {
    kind: 'start',
    id: 'intent',
    title: 'Intent',
    block: 'Bloque 1',
    position: at(0, 0),
    fields: [
      {
        key: 'intent',
        label: 'Intent: qué quieres lograr y para quién (no cómo)',
        options: [],
        optional: false
      },
      {
        key: 'tipo',
        label: 'Tipo de tarea (decide la ruta)',
        options: ['feature', 'bug', 'refactor', 'investigacion'],
        optional: false
      },
      {
        key: 'idea_inicial',
        label: 'Idea inicial (opcional): cómo te la imaginas, si ya la tienes',
        options: [],
        optional: true
      }
    ]
  },
  {
    kind: 'agent',
    id: 'investigacion',
    title: 'Investigación',
    block: 'Ruta: investigación',
    position: at(1, -1.4),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: true,
    prompt: `Investiga la pregunta del Intent sin cambiar el producto.
- Responde con evidencia: lee el código, corre comandos, haz sondas o prototipos desechables y mide cuando aplique. Nada de opiniones sin respaldo.
- No dejes cambios en el workspace: si creaste prototipos, bórralos o dilo con su ruta.
Entrega: la respuesta en 3 a 5 líneas, la evidencia (comandos, rutas, salidas) y qué harías a continuación.`,
    inputs: ['intent', 'idea_inicial'],
    outputKey: 'investigacion',
    joinAll: false,
    maxVisits: 3,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'idea',
    title: 'Desarrollo de la idea',
    block: 'Bloque 1',
    position: at(1, 0),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: false,
    prompt: `Con el Intent registrado, describe la idea: qué haría, cómo se vería y qué cambiaría para quien la use.
Si el usuario dio una idea inicial, parte de ella: ordénala y complétala, pero no la reemplaces por otra. Si no la dio, propón la versión más simple que sea fiel al Intent.
Si el usuario llegó con una solución ("agrega un botón que..."), identifica la intención detrás.
Si hay respuestas de rondas anteriores, incorpóralas.
Entrega un solo párrafo con el formato **Idea (vN):** ..., donde N es el número de ronda. No escribas código ni propongas soluciones técnicas.`,
    inputs: ['intent', 'tipo', 'idea_inicial', 'idea', 'respuesta'],
    outputKey: 'idea',
    joinAll: false,
    maxVisits: 10,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'usabilidad',
    title: '🧭 Agente Usabilidad',
    block: 'Bloque 1 · Mesa',
    position: at(2, -1),
    agent: null,
    reuseSession: false,
    runner: 'subagent',
    allowEdits: false,
    prompt: `Cuestiona la idea desde quien la va a usar.
- ¿Quién es exactamente el usuario y en qué momento la usa?
- ¿Qué tan fácil es entenderla la primera vez? ¿Qué pasos sobran?
- ¿Qué pasa cuando el usuario se equivoca, se pierde o abandona a medias?
- ¿Resuelve un problema real que el usuario siente, o uno que imaginamos?

${MESA_RULES}`,
    inputs: ['intent', 'idea', 'respuesta'],
    outputKey: 'usabilidad',
    joinAll: false,
    maxVisits: 10,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'ingeniero',
    title: '🛠️ Agente Ingeniero',
    block: 'Bloque 1 · Mesa',
    position: at(2, 0),
    agent: null,
    reuseSession: false,
    runner: 'subagent',
    allowEdits: false,
    prompt: `Cuestiona cómo se construiría, sin jerga técnica: habla de piezas, datos, dependencias y riesgos como se los explicarías a alguien que no programa. Puedes leer el código del proyecto para fundamentar tus preguntas.
- ¿Qué información necesita guardarse o moverse, y de dónde sale?
- ¿Qué partes ya existen en el proyecto y cuáles serían nuevas?
- ¿Qué podría romperse, quedar lento o ser difícil de mantener?
- ¿Hay una versión más simple que logre lo mismo?

${MESA_RULES}`,
    inputs: ['intent', 'idea', 'respuesta'],
    outputKey: 'ingeniero',
    joinAll: false,
    maxVisits: 10,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'viabilidad',
    title: '⚖️ Agente Viabilidad',
    block: 'Bloque 1 · Mesa',
    position: at(2, 1),
    agent: null,
    reuseSession: false,
    runner: 'subagent',
    allowEdits: false,
    prompt: `Cuestiona si vale la pena y si la idea sigue fiel al Intent.
- ¿Qué tan cerca está la idea actual de la intención original? Califica: alta / media / baja y explica por qué.
- ¿La idea se desvió, creció de más o se quedó corta respecto al Intent?
- ¿El esfuerzo es proporcional al valor? ¿Qué se puede dejar fuera?
- ¿Hay supuestos que habría que validar antes de seguir?

${MESA_RULES}`,
    inputs: ['intent', 'idea', 'respuesta'],
    outputKey: 'viabilidad',
    joinAll: false,
    maxVisits: 10,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'sintesis',
    title: 'Síntesis de la ronda',
    block: 'Bloque 1',
    position: at(3, 0),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: false,
    prompt: `Presenta las respuestas de los agentes juntas, como una conversación de mesa, con este formato:

### Ronda N
**🧭 Usabilidad:** ...
**🛠️ Ingeniero:** ...
**⚖️ Viabilidad:** (alineación con el intent: alta/media/baja) ...

**Puntos en común / tensiones:** ...
**Preguntas para ti (priorizadas):** 1. ... 2. ... 3. ...

No respondas las preguntas por el usuario. Si una pregunta se puede resolver con un prototipo o una sonda (no es de producto ni de gusto), sácala de la lista y di qué agente debe probarla en la siguiente ronda.`,
    inputs: ['intent', 'idea', 'usabilidad', 'ingeniero', 'viabilidad'],
    outputKey: 'sintesis',
    joinAll: true,
    maxVisits: 10,
    limitTarget: null
  },
  {
    kind: 'human',
    id: 'respuesta',
    title: 'Respuesta del usuario',
    block: 'Bloque 1',
    position: at(4, 0),
    prompt:
      'Responde las preguntas de la ronda y elige cómo seguir: más rondas, cambiar el Intent o consolidar la idea.',
    inputs: ['sintesis'],
    outputKey: 'respuesta',
    joinAll: false,
    maxVisits: 10,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'consolidada',
    title: 'Idea consolidada',
    block: 'Bloque 1',
    position: at(5, 0),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: false,
    prompt: `Entrega un resumen final con: Intent, Tipo, Idea final, decisiones tomadas en cada ronda y preguntas que quedaron abiertas a propósito. Este resumen es la entrada de la implementación.`,
    inputs: ['intent', 'tipo', 'idea', 'sintesis', 'respuesta'],
    outputKey: 'consolidada',
    joinAll: false,
    maxVisits: 5,
    limitTarget: null
  }
]
