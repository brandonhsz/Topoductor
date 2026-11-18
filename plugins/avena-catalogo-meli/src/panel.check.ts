// `topo plugin check` renders the panel once per scenario, each with the worker on a fresh host.
import { defineCheck } from 'orca/testing'
import { REVIEW_FIXTURE } from './panel-fixture'

export default defineCheck({
  // An in-memory database, so a check never touches the real file.
  sinConexiones: { settings: { databasePath: ':memory:' } },
  conCatalogo: {
    secrets: {
      mongoUri: 'mongodb+srv://reader',
      backendEmail: 'admin@ejemplo.com',
      backendPassword: 'x'
    },
    settings: {
      backendUrl: 'https://api.ejemplo.com',
      backendPricesPath: '/api/prices',
      mongoDatabase: 'catalogo',
      mongoCollection: 'productos',
      catalogOwner: 'acme',
      databasePath: ':memory:'
    },
    // Kept in storage the way older versions did: the worker moves it into the database.
    storage: { catalog: REVIEW_FIXTURE }
  }
})
