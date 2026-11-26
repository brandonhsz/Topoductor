import { describe, expect, it } from 'vitest'
import { harnessWavePlanProblems, isRedWave, parseHarnessWavePlan } from './harness-wave-plan'

function plan(tasks: object[]): ReturnType<typeof parseHarnessWavePlan> {
  return parseHarnessWavePlan(`\`\`\`json\n${JSON.stringify({ tasks })}\n\`\`\``)
}

describe('harness wave plan', () => {
  it('reads the red phase flag and treats only all-red waves as red', () => {
    const parsed = plan([
      { id: 'T1', role: 'Pruebas', title: 'rojo', wave: 1, red: true },
      { id: 'T2', role: 'Lógica', title: 'contrato', wave: 0 },
      { id: 'T3', role: 'Pruebas', title: 'config', wave: 0, red: true }
    ])!
    expect(parsed.waves.map(({ tasks }) => isRedWave(tasks))).toEqual([false, true])
    expect(isRedWave([])).toBe(false)
  })

  it('reports shared files within a wave and dependencies that do not finish first', () => {
    const parsed = plan([
      { id: 'T1', role: 'Lógica', title: 'a', wave: 1, files: ['src/a.ts'] },
      { id: 'T2', role: 'Visual', title: 'b', wave: 1, files: ['src/a.ts'], dependsOn: ['T1'] },
      { id: 'T3', role: 'Visual', title: 'c', wave: 2, files: ['src/a.ts'], dependsOn: ['T9'] }
    ])!
    expect(harnessWavePlanProblems(parsed)).toEqual([
      'T2 (oleada 1) depende de T1 (oleada 1), que no termina antes.',
      'T1 y T2 tocan src/a.ts en la misma oleada 1.',
      'T3 depende de T9, que no está en el plan.'
    ])
  })

  it('accepts a plan that follows its own rules', () => {
    const parsed = plan([
      { id: 'T1', role: 'Lógica', title: 'a', wave: 0, files: ['src/a.ts'] },
      { id: 'T2', role: 'Visual', title: 'b', wave: 1, files: ['src/a.ts'], dependsOn: ['T1'] }
    ])!
    expect(harnessWavePlanProblems(parsed)).toEqual([])
  })
})
