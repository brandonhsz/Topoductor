import { describe, expect, it } from 'vitest'
import {
  FAN_CONTROL_HELPER_COMMANDS,
  FAN_CONTROL_SESSION_ARGS,
  FAN_CONTROL_TARGETS_VERSION
} from '../../shared/fan-control-contract'
import {
  buildFanControlSessionCommand,
  parseFanSensorsOutput,
  serializeFanTargets
} from './fan-control-helper-protocol'

const SENSORS = {
  chip: [
    { key: 'Tp01', c: 55.2 },
    { key: 'Te05', c: 61 }
  ],
  palmrest: [
    { key: 'Ts0P', c: 33.1 },
    { key: 'Ts1P', c: 32.4 }
  ],
  battery: [{ key: 'TB0T', c: 35 }]
}

describe('parseFanSensorsOutput', () => {
  it('parses the helper line, trimming the trailing newline', () => {
    expect(parseFanSensorsOutput(`${JSON.stringify(SENSORS)}\n`)).toEqual(SENSORS)
  })

  it('keeps empty groups on a Mac without palm-rest sensors', () => {
    const output = { ...SENSORS, palmrest: [] }
    expect(parseFanSensorsOutput(JSON.stringify(output))).toEqual(output)
  })

  it('drops unknown top-level fields', () => {
    expect(parseFanSensorsOutput(JSON.stringify({ ...SENSORS, gpu: [] }))).toEqual(SENSORS)
  })

  it.each([
    ['non-JSON text', 'Tp01=55.2'],
    ['an empty string', ''],
    ['the helper error line', '{"error":"cannot open AppleSMC"}'],
    ['a missing group', JSON.stringify({ chip: SENSORS.chip, palmrest: SENSORS.palmrest })],
    ['a group that is not an array', JSON.stringify({ ...SENSORS, chip: {} })],
    ['a non-numeric reading', JSON.stringify({ ...SENSORS, chip: [{ key: 'Tp01', c: '55' }] })],
    ['a reading without a key', JSON.stringify({ ...SENSORS, battery: [{ c: 35 }] })],
    ['a JSON array', JSON.stringify([SENSORS])]
  ])('returns null for %s', (_label, stdout) => {
    expect(parseFanSensorsOutput(stdout)).toBeNull()
  })
})

describe('buildFanControlSessionCommand', () => {
  it('runs the control command detached with the parent pid and lease', () => {
    const command = buildFanControlSessionCommand({
      helperPath: '/Applications/Topo.app/Contents/Resources/topo-fan-control',
      parentPid: 4242,
      leasePath: '/Users/me/Library/Application Support/topo/fan-control.lease'
    })
    expect(command).toBe(
      [
        "'/Applications/Topo.app/Contents/Resources/topo-fan-control'",
        FAN_CONTROL_HELPER_COMMANDS.control,
        FAN_CONTROL_SESSION_ARGS.parentPid,
        '4242',
        FAN_CONTROL_SESSION_ARGS.lease,
        "'/Users/me/Library/Application Support/topo/fan-control.lease'",
        '>/dev/null 2>&1 &'
      ].join(' ')
    )
  })

  it('quotes paths so embedded single quotes and shell metacharacters stay literal', () => {
    const command = buildFanControlSessionCommand({
      helperPath: "/Users/o'neil/Topo.app/topo-fan-control",
      parentPid: 1,
      leasePath: '/tmp/$(rm -rf ~)/fan.lease'
    })
    expect(command).toContain("'/Users/o'\\''neil/Topo.app/topo-fan-control'")
    expect(command).toContain("'/tmp/$(rm -rf ~)/fan.lease'")
  })
})

describe('serializeFanTargets', () => {
  it('writes the versioned lease line, null handing a fan to macOS', () => {
    expect(serializeFanTargets([3500, null])).toBe('{"v":1,"targets":[3500,null]}')
    expect(JSON.parse(serializeFanTargets([3500, null])).v).toBe(FAN_CONTROL_TARGETS_VERSION)
  })

  it('writes an all-macOS line for an empty target list', () => {
    expect(serializeFanTargets([])).toBe('{"v":1,"targets":[]}')
  })

  it('rounds fractional rpm from curve interpolation to whole rpm', () => {
    expect(serializeFanTargets([3500.6, 2317.2])).toBe('{"v":1,"targets":[3501,2317]}')
  })
})
