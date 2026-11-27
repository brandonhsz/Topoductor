import * as SecureStore from 'expo-secure-store'
import * as z from 'zod'

// Kept off iCloud Keychain and backups, like the pairing credentials.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}

const CredentialSchema = z.object({ username: z.string(), password: z.string() })
export type RemoteDesktopCredential = z.infer<typeof CredentialSchema>

// SecureStore keys allow only alphanumerics, '.', '-' and '_'.
function storageKey(hostId: string): string {
  return `topo.remote-desktop.${hostId.replace(/[^A-Za-z0-9._-]/g, '_')}`
}

export async function loadRemoteDesktopCredential(
  hostId: string
): Promise<RemoteDesktopCredential | null> {
  try {
    const raw = await SecureStore.getItemAsync(storageKey(hostId), OPTIONS)
    if (!raw) {
      return null
    }
    const parsed = CredentialSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function saveRemoteDesktopCredential(
  hostId: string,
  credential: RemoteDesktopCredential
): Promise<void> {
  await SecureStore.setItemAsync(storageKey(hostId), JSON.stringify(credential), OPTIONS)
}

export async function forgetRemoteDesktopCredential(hostId: string): Promise<void> {
  await SecureStore.deleteItemAsync(storageKey(hostId), OPTIONS).catch(() => undefined)
}
