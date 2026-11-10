import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TopoCloudCapabilities,
  TopoCloudOrgSummary,
  TopoProfileCloudSummary
} from '../../shared/topo-profiles'

const {
  beginTopoCloudPkceFlowMock,
  exchangeTopoCloudAuthCodeMock,
  revokeTopoCloudSessionMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginTopoCloudPkceFlowMock: vi.fn(),
  exchangeTopoCloudAuthCodeMock: vi.fn(),
  revokeTopoCloudSessionMock: vi.fn(),
  safeStorageMock: {
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    isEncryptionAvailable: vi.fn(() => true)
  }
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath },
  safeStorage: safeStorageMock
}))

vi.mock('./profile-cloud-pkce', () => ({
  beginTopoCloudPkceFlow: beginTopoCloudPkceFlowMock
}))

vi.mock('./profile-cloud-client', () => ({
  createTopoCloudProfile: vi.fn(),
  exchangeTopoCloudAuthCode: exchangeTopoCloudAuthCodeMock,
  revokeTopoCloudSession: revokeTopoCloudSessionMock,
  selectTopoCloudOrg: vi.fn()
}))

import {
  connectCurrentTopoProfile,
  getCurrentTopoProfileAuthStatus,
  signOutCurrentTopoProfile
} from './profile-cloud-service'

const cloud: TopoProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const laterCloud: TopoProfileCloudSummary = {
  ...cloud,
  cloudProfileId: 'cloud-profile-2',
  email: 'ada@example.com'
}

const capabilities: TopoCloudCapabilities = { flags: { share: true }, refreshedAt: 11 }
const organizations: TopoCloudOrgSummary[] = [{ orgId: 'org-1', name: 'Acme', role: 'Admin' }]

describe('Topo cloud sign-out vs newer connect', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'topo-cloud-sign-out-connect-'))
    beginTopoCloudPkceFlowMock.mockReset()
    exchangeTopoCloudAuthCodeMock.mockReset()
    revokeTopoCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.stubEnv('TOPO_CLOUD_API_URL', 'https://topo-cloud.example')
    vi.stubEnv('TOPO_CLOUD_CLIENT_ID', 'desktop-client')
    beginTopoCloudPkceFlowMock.mockResolvedValue({
      code: 'auth-code',
      codeVerifier: 'code-verifier',
      nonce: 'nonce',
      redirectUri: 'http://127.0.0.1:4100/auth/callback',
      state: 'state'
    })
    exchangeTopoCloudAuthCodeMock.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3_600_000,
      cloud,
      organizations,
      capabilities
    })
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('keeps a newer connect that finishes while sign-out is still revoking', async () => {
    await expect(connectCurrentTopoProfile(userDataPath)).resolves.toMatchObject({
      status: 'connected'
    })
    let finishRevoke!: () => void
    revokeTopoCloudSessionMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRevoke = resolve
      })
    )
    const signingOut = signOutCurrentTopoProfile(userDataPath)
    exchangeTopoCloudAuthCodeMock.mockResolvedValue({
      accessToken: 'later-access',
      refreshToken: 'later-refresh',
      expiresAt: Date.now() + 3_600_000,
      cloud: laterCloud,
      organizations,
      capabilities
    })
    await expect(connectCurrentTopoProfile(userDataPath)).resolves.toMatchObject({
      status: 'connected'
    })
    expect(getCurrentTopoProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')
    finishRevoke()
    await expect(signingOut).resolves.toMatchObject({ status: 'signed-out' })
    expect(getCurrentTopoProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'connected',
      cloud: { email: 'ada@example.com' }
    })
  })
})
