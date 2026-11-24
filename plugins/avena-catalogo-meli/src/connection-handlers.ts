// Connection settings: what the panel shows as configured, and saving Mongo/backend secrets.
import type { OrcaWorkerApi } from 'orca/worker'
import { mongoLocation, readCatalogConfig } from './catalog-config'
import { normalizeMongoUri, type CatalogSource, type MongoLocation } from './catalog-source'
import type { ConnectionStatus } from './protocol'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerConnectionHandlers(
  orca: OrcaWorkerApi,
  catalogSource: (uri: string, location: MongoLocation) => CatalogSource
): void {
  const config = () => readCatalogConfig(orca)

  async function status(): Promise<ConnectionStatus> {
    const [mongoUri, email, password, current] = await Promise.all([
      orca.secrets.get('mongoUri'),
      orca.secrets.get('backendEmail'),
      orca.secrets.get('backendPassword'),
      config()
    ])
    return {
      mongo: Boolean(
        mongoUri && current.mongoDatabase && current.mongoCollection && current.catalogOwner
      ),
      backend: Boolean(email && password && current.backendUrl && current.backendPricesPath),
      config: current
    }
  }

  orca.panels.handle('connection.save', async (input) => {
    for (const [key, value] of Object.entries(input.config ?? {})) {
      if (typeof value === 'string') {
        await orca.settings.set(key, value.trim())
      }
    }
    const mongoUri = input.mongoUri?.trim() ? normalizeMongoUri(input.mongoUri) : null
    if (mongoUri) {
      // Test before storing so a bad URI never replaces one that works.
      try {
        await catalogSource(mongoUri, mongoLocation(await config()))([])
      } catch (error) {
        return {
          status: await status(),
          result: { ok: false, message: `No se pudo conectar a Mongo: ${message(error)}` }
        }
      }
      await orca.secrets.set('mongoUri', mongoUri)
    }
    const entries: [string, string | undefined][] = [
      ['backendEmail', input.backendEmail],
      ['backendPassword', input.backendPassword]
    ]
    for (const [key, value] of entries) {
      if (value?.trim()) {
        await orca.secrets.set(key, value.trim())
      }
    }
    return {
      status: await status(),
      result: { ok: true, message: 'Conexiones guardadas en los secretos del plugin.' }
    }
  })

  orca.panels.handle('connection.status', status)
}
