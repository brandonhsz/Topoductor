// A startTopod test that fails partway must not leave latches closed: later tests in the worker would wait 10 s.
import { afterEach } from 'vitest'
import { _resetTopodFeatureReadinessForTests } from '../../../../src/main/runtime/rpc/topod-feature-readiness'

afterEach(() => {
  _resetTopodFeatureReadinessForTests()
})
