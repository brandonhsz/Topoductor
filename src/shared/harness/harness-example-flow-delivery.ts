import type { HarnessNode } from './harness-flow-types'
import { at } from './harness-example-flow-ideation'

/** Bloques 2–5: plan, waves, evidence, fixes and the final video. */
export const DELIVERY_NODES: HarnessNode[] = [
  {
    kind: 'agent',
    id: 'plan',
    title: 'Contrato y tareas',
    block: 'Bloque 2',
    position: at(0, 2),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: false,
    prompt: `Rompe la Idea consolidada en tareas pequeñas que varios agentes puedan trabajar en paralelo sin pisarse. No escribas código: solo produce el plan. Lee el proyecto para ubicar las capas y archivos reales.

1. Contrato entre capas: tipos de datos nuevos o modificados y firmas de las funciones o endpoints que la UI va a llamar (qué reciben, qué devuelven y qué errores pueden ocurrir). El contrato es la primera tarea y es del rol Lógica.
2. Tareas: cada una pertenece a un solo rol (Visual, Lógica o Pruebas), es pequeña, tiene criterios de aceptación verificables y declara dependencias y archivos. Dos tareas que modifican el mismo archivo no pueden ir en la misma oleada. Cada tarea de Visual o Lógica tiene una tarea de Pruebas que la precede (fase roja del TDD).
3. Oleadas: oleada 0 = configuración de pruebas (si falta) y el contrato; oleada 1 = pruebas en rojo, marcadas con \`"red": true\` porque deben fallar hasta que exista la implementación; oleadas 2…N = Visual y Lógica en paralelo. Una tarea solo depende de tareas de oleadas anteriores.
4. Si aparece una duda de fondo sobre la idea, dilo en "Riesgos y preguntas abiertas" en lugar de inventar la respuesta.
5. Si recibes «plan_problemas», Topo encontró que el plan anterior rompía estas reglas: corrígelos todos.

Presenta el plan en markdown (Contrato, tabla de Tareas con ID/Rol/Tarea/Criterios/Depende de/Archivos/Oleada, Riesgos y preguntas abiertas) y al final incluye el mismo plan en un bloque \`\`\`json con este formato exacto:
{"tasks":[{"id":"T1","role":"Lógica","title":"...","criteria":"...","dependsOn":[],"files":["..."],"wave":0,"red":false}]}`,
    inputs: [
      'intent',
      'tipo',
      'idea_inicial',
      'consolidada',
      'reproduccion',
      'aprobacion',
      'plan_problemas'
    ],
    freshInputs: ['aprobacion', 'plan_problemas'],
    outputKey: 'plan',
    joinAll: false,
    maxVisits: 10,
    limitTarget: null
  },
  {
    kind: 'human',
    id: 'aprobacion',
    title: 'Aprobación del plan',
    block: 'Bloque 2',
    position: at(1, 2),
    prompt:
      'Revisa el contrato, las tareas y las oleadas. Apruébalo, pide ajustes o regresa a la idea si está incompleta.',
    inputs: ['plan'],
    outputKey: 'aprobacion',
    joinAll: false,
    maxVisits: 10,
    limitTarget: null
  },
  {
    kind: 'waves',
    id: 'ejecucion',
    title: 'Ejecución por oleadas',
    block: 'Bloque 2',
    position: at(2, 2),
    planKey: 'plan',
    inputs: ['consolidada'],
    verifyCommand: '',
    checkpointEachWave: true,
    runner: 'chat',
    allowEdits: true,
    outputKey: 'ejecucion',
    joinAll: false,
    maxVisits: 5,
    limitTarget: null,
    roles: [
      {
        name: 'Pruebas',
        agent: null,
        prompt: `Eres el agente de Pruebas (TDD), dueño de la calidad. Solo tocas archivos de prueba y la configuración de pruebas.
- Rojo: escribe las pruebas de la tarea a partir de sus criterios de aceptación, antes de que exista la implementación, y confirma que fallan.
- Verificación: corre toda la suite, revisa que no haya regresiones y reporta lo que falle indicando el rol dueño.
- Prueba la lógica con pruebas unitarias y la UI con pruebas de componente.
- Si el proyecto no tiene corredor de pruebas, configúralo primero.`,
        paths: []
      },
      {
        name: 'Visual',
        agent: null,
        prompt: `Eres el agente Visual (UI). Implementas todo lo que se ve y con lo que se interactúa: componentes, páginas, layout, estilos, estados visuales (cargando, vacío, error), accesibilidad y responsive.
- Consumes datos y acciones solo a través del contrato. Nunca accedes a la base de datos ni a la lógica directamente.
- Implementa lo mínimo para que las pruebas de la tarea pasen. No modifiques pruebas; si crees que una está mal, dilo.`,
        paths: []
      },
      {
        name: 'Lógica',
        agent: null,
        prompt: `Eres el agente de Lógica y Datos. Implementas todo lo que no es visual: modelos y tipos, persistencia, reglas de negocio, acciones del servidor, rutas de API y webhooks.
- Expones exactamente lo que dice el contrato. No escribes UI ni estilos.
- Implementa lo mínimo para que las pruebas de la tarea pasen. No modifiques pruebas; si crees que una está mal, dilo.`,
        paths: []
      }
    ]
  },
  {
    kind: 'agent',
    id: 'analisis',
    title: 'Análisis con evidencias',
    block: 'Bloque 3',
    position: at(3, 2),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: true,
    prompt: `Analiza el resultado viéndolo funcionar en la app real, no solo leyendo el código o confiando en las pruebas. No arregles código en este nodo: solo observa y reporta.
1. Plan de evidencias: por cada tarea de Visual o Lógica, define qué captura (un estado) o video (una interacción) demuestra su criterio de aceptación. Las tareas sin pantalla se evidencian por su efecto visible o por la salida de las pruebas.
2. Levanta la app (reutilízala si ya corre). Si no compila o muestra un error, eso ya es un hallazgo.
3. Graba cada evidencia señalando el punto de interés y con una leyenda de qué se demuestra. Incluye una verificación del resultado esperado. No ensucies datos reales: lo que crees lleva el prefijo [evidencia] y se borra al final.
4. Revisa cada captura antes de reportar.
5. Informe:

### Análisis con evidencias
| Tarea | Criterio | Evidencia | Veredicto |
|-------|----------|-----------|-----------|
| T5 | ... | ruta completa | ✅ cumple / ❌ no cumple / ⚠️ parcial |

**Hallazgos:** qué falla, en qué paso y qué evidencia lo muestra, y qué rol es dueño del problema.`,
    inputs: ['consolidada', 'plan', 'ejecucion', 'correccion'],
    freshInputs: ['correccion'],
    outputKey: 'analisis',
    joinAll: false,
    maxVisits: 6,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'correccion',
    title: 'Validación y corrección',
    block: 'Bloque 4',
    position: at(3, 3.2),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: true,
    prompt: `Resuelve cada hallazgo y demuéstralo con la misma evidencia que lo detectó.
1. Respalda las evidencias "antes" de tocar nada.
2. Clasifica cada hallazgo: Visual, Lógica y datos, Prueba equivocada, Evidencia mal hecha o Problema de la idea. Si no está claro, investiga la causa antes de asignarlo.
3. Rojo: escribe una prueba que reproduce el hallazgo y confirma que falla.
4. Verde: corrige lo mínimo en la capa dueña, sin modificar pruebas.
5. Corre la suite completa y vuelve a grabar la misma evidencia sin cambiar el escenario. Compara antes y después.

Informe:
### Validación de evidencias — ronda N
| Hallazgo | Tipo / rol | Causa | Corrección | Antes | Después | Estado |
**Pruebas:** X pasaron, Y fallaron.
**Pendientes / escalados:** ...

Un hallazgo no se marca ✅ sin su evidencia "después".`,
    inputs: ['analisis', 'interrogatorio', 'plan'],
    // Each round fixes only the findings that sent it here, not the ones an earlier round closed.
    freshInputs: ['analisis', 'interrogatorio'],
    outputKey: 'correccion',
    joinAll: false,
    maxVisits: 3,
    limitTarget: 'escalado'
  },
  {
    kind: 'human',
    id: 'escalado',
    title: 'Decisión sobre hallazgos',
    block: 'Bloque 4',
    position: at(4, 3.2),
    prompt:
      'Los hallazgos no se resolvieron tras los intentos. Decide si reintentar, aceptar los pendientes o revisar la idea.',
    inputs: ['correccion'],
    outputKey: 'escalado',
    joinAll: false,
    maxVisits: 5,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'evidencia_final',
    title: 'Evidencia final',
    block: 'Bloque 5',
    position: at(4, 2),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: true,
    prompt: `Genera un solo video con señales que muestre lo que se trabajó, de principio a fin.
- Feature: portada con el Intent, recorrido de cada tarea en el orden en que la usaría una persona real (leyenda, señal numerada, pausa) y cierre con una línea por tarea.
- Bug: el mismo guion de la reproducción (ver «reproduccion»), grabado con el fix, compuesto lado a lado con el video "antes" (izquierda error, derecha fix).
- Refactor: demuestra que el comportamiento no cambió. Recorre los flujos que toca el refactor en la app y muestra la suite de pruebas pasando; si no hay nada visible, la salida de las pruebas antes y después es la evidencia.
- Investigación no llega aquí.
Revisa capturas de los puntos clave antes de entregar.

### Evidencia final
**Intent:** ...   **Tipo:** feature | bug | refactor
**Video:** ruta completa
**Qué se ve:** 1) ... 2) ... 3) ...`,
    inputs: ['intent', 'tipo', 'consolidada', 'reproduccion', 'analisis', 'correccion'],
    freshInputs: ['correccion'],
    outputKey: 'evidencia_final',
    joinAll: false,
    maxVisits: 3,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'reproduccion',
    title: 'Grabar reproducción del bug',
    block: 'Ruta: bug',
    position: at(0, 1),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: true,
    prompt: `Antes de que cualquier agente toque código, reproduce el error y deja evidencia, porque después del fix ya no se podrá grabar.
1. Escribe un guion neutral que reproduzca el error paso a paso; los mismos pasos deben servir después para mostrar el fix.
2. Grábalo (video o capturas) señalando el punto donde falla, sin un expect que corte la grabación.
3. Guarda la evidencia "antes" en una carpeta de entregables ignorada por git y da su ruta completa.
Si el error no se reproduce, dilo: sin reproducción no hay bug confirmado.`,
    inputs: ['intent', 'idea_inicial', 'tipo'],
    outputKey: 'reproduccion',
    joinAll: false,
    maxVisits: 3,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'abrir_pr',
    title: 'Abrir PR',
    block: 'Bloque 5',
    position: at(5, 2),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: true,
    prompt: `Publica el trabajo para revisión siguiendo las reglas del repositorio (nombre de rama, formato de commits, checks previos al push).
Mira el modo de PR en la sección Proyecto.
- PR único: revisa que no queden cambios sin commit y que los checks pasen, sube la rama y abre un pull request (o merge request, según el proveedor: gh, glab…) con el Intent, qué se construyó, cómo se verificó y la ruta del video final.
- PRs apilados: los PRs por oleada ya se abrieron al cerrar cada oleada. Verifica que la pila esté completa y en orden, sube los cambios de corrección que falten como un PR final encima de la pila y escribe en el primero el orden de revisión.
Responde con los enlaces. Si algo lo impide (sin remoto, checks rotos, sin permisos), dilo con la salida real.`,
    inputs: ['intent', 'tipo', 'consolidada', 'ejecucion', 'evidencia_final'],
    outputKey: 'pr',
    joinAll: false,
    maxVisits: 3,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'aprendizajes',
    title: 'Aprendizajes',
    block: 'Mejora continua',
    position: at(6, 2),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: false,
    prompt: `Revisa esta corrida para que el sistema no repita sus errores. Usa el historial (reintentos, fallas, escalados, decisiones) y los hallazgos.
Por cada lección, propón cómo volverla estructural, en este orden de preferencia:
1. Una regla de lint, check o script del repositorio que lo detecte solo.
2. Un cambio a un nodo o prompt del flujo (di qué nodo y el texto exacto).
3. Una regla en las reglas compartidas del flujo o en los datos del proyecto del repo.
Descarta lecciones que fueron mala suerte puntual. Formato: tabla Lección | Evidencia en la corrida | Propuesta | Tipo (lint/check, nodo, regla). Si no hubo nada que aprender, dilo.`,
    inputs: ['historial', 'analisis', 'correccion', 'escalado', 'ejecucion'],
    outputKey: 'aprendizajes',
    joinAll: false,
    maxVisits: 3,
    limitTarget: null
  },
  {
    kind: 'human',
    id: 'aplicar_aprendizajes',
    title: '¿Aplicar aprendizajes?',
    block: 'Mejora continua',
    position: at(7, 2),
    prompt:
      'Elige qué hacer con las propuestas. Los cambios de lint, checks o scripts los aplica un agente en el repo; los cambios a nodos o reglas del flujo los editas tú en Harness.',
    inputs: ['aprendizajes'],
    outputKey: 'decision_aprendizajes',
    joinAll: false,
    maxVisits: 3,
    limitTarget: null
  },
  {
    kind: 'agent',
    id: 'implementar_aprendizajes',
    title: 'Implementar aprendizajes',
    block: 'Mejora continua',
    position: at(7, 3.2),
    agent: null,
    reuseSession: true,
    runner: 'chat',
    allowEdits: true,
    prompt: `Implementa en el repositorio solo las propuestas de tipo lint/check/script que la persona aprobó (ver su decisión). Cada regla nueva debe fallar con el error original y pasar con el código actual: demuéstralo con la salida real. Haz commit aparte para cada una. No toques CLAUDE.md ni AGENTS.md. Al final lista qué quedó y qué cambios al flujo debe hacer la persona a mano.`,
    inputs: ['aprendizajes', 'decision_aprendizajes'],
    outputKey: 'aprendizajes_aplicados',
    joinAll: false,
    maxVisits: 3,
    limitTarget: null
  },
  {
    kind: 'end',
    id: 'entregado',
    title: 'Entregado',
    block: 'Bloque 5',
    position: at(8, 2)
  }
]
