// Everything company-specific is typed into Topo: settings for locations, secrets for credentials.
import type { OrcaWorkerApi } from 'orca/worker'
import type { BackendCredentials } from './backend-client'
import type { MongoLocation } from './catalog-source'
import type { CatalogConfig } from './protocol'

export async function readCatalogConfig(orca: OrcaWorkerApi): Promise<CatalogConfig> {
  const settings = await orca.settings.get()
  const value = (key: keyof CatalogConfig): string =>
    typeof settings[key] === 'string' ? String(settings[key]).trim() : ''
  return {
    backendUrl: value('backendUrl'),
    backendPricesPath: value('backendPricesPath'),
    mongoDatabase: value('mongoDatabase'),
    mongoCollection: value('mongoCollection'),
    catalogOwner: value('catalogOwner')
  }
}

export function mongoLocation(config: CatalogConfig): MongoLocation {
  if (!config.mongoDatabase || !config.mongoCollection || !config.catalogOwner) {
    throw new Error('Faltan la base, la colección o el owner de Mongo: agrégalos en Conexiones.')
  }
  return {
    database: config.mongoDatabase,
    collection: config.mongoCollection,
    owner: config.catalogOwner
  }
}

export async function backendCredentials(orca: OrcaWorkerApi): Promise<BackendCredentials> {
  const [email, password, config] = await Promise.all([
    orca.secrets.get('backendEmail'),
    orca.secrets.get('backendPassword'),
    readCatalogConfig(orca)
  ])
  if (!email || !password) {
    throw new Error('Faltan las credenciales de admin del backend: agrégalas en Conexiones.')
  }
  if (!config.backendUrl || !config.backendPricesPath) {
    throw new Error('Faltan la URL y la ruta del backend: agrégalas en Conexiones.')
  }
  return { email, password, baseUrl: config.backendUrl, path: config.backendPricesPath }
}
