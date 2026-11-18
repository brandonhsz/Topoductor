// `topo plugin check` renders the panel once per scenario, each with the worker on a fresh host.
import { defineCheck } from 'orca/testing'
import { REVIEW_FIXTURE } from './panel-fixture'

export default defineCheck({
  sinConexiones: {},
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
      catalogOwner: 'acme'
    },
    storage: { catalog: REVIEW_FIXTURE }
  }
})
