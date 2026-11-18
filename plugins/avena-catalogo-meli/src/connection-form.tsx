import { atom, Badge, Button, Input, plugin, read, Row, set, Stack, Text } from 'orca'
import { connection, runAction } from './panel-state'
import type { CatalogConfig } from './protocol'

const mongoUri = atom('')
const backendEmail = atom('')
const backendPassword = atom('')
// Only the fields a person typed in; empty means "keep the saved value".
const configDraft = atom<Partial<CatalogConfig>>({})

const CONFIG_FIELDS: { key: keyof CatalogConfig; label: string; example: string }[] = [
  { key: 'mongoDatabase', label: 'Base de Mongo', example: 'catalogo' },
  { key: 'mongoCollection', label: 'Colección de Mongo', example: 'productos' },
  { key: 'catalogOwner', label: 'Owner de los productos', example: 'mi-empresa' },
  { key: 'backendUrl', label: 'URL del backend', example: 'https://api.ejemplo.com' },
  { key: 'backendPricesPath', label: 'Ruta del endpoint de escritura', example: '/api/prices' }
]

function hasInput(): boolean {
  return (
    Boolean(read(mongoUri).trim() || read(backendEmail).trim() || read(backendPassword).trim()) ||
    Object.values(read(configDraft)).some((value) => Boolean(value?.trim()))
  )
}

async function save(): Promise<void> {
  await runAction('connection', async () => {
    const typed = Object.fromEntries(
      Object.entries(read(configDraft)).filter(([, value]) => Boolean(value?.trim()))
    )
    const { status, result } = await plugin.request('connection.save', {
      mongoUri: read(mongoUri),
      backendEmail: read(backendEmail),
      backendPassword: read(backendPassword),
      config: typed
    })
    set(connection, status)
    if (result.ok) {
      set(mongoUri, '')
      set(backendPassword, '')
      set(configDraft, {})
    }
    return result
  })
}

export function ConnectionForm() {
  const status = read(connection)
  const draft = read(configDraft)
  return (
    <Stack gap="sm">
      <Row gap="xs" wrap>
        <Badge tone={status?.mongo ? 'success' : 'warning'}>
          Mongo {status?.mongo ? 'listo' : 'pendiente'}
        </Badge>
        <Badge tone={status?.backend ? 'success' : 'warning'}>
          Backend {status?.backend ? 'listo' : 'pendiente'}
        </Badge>
      </Row>
      <Input
        label="URI de Mongo (solo lectura)"
        type="password"
        placeholder={status?.mongo ? 'Guardada — escribe otra para cambiarla' : 'mongodb+srv://…'}
        value={read(mongoUri)}
        onChange={(value) => set(mongoUri, value)}
      />
      {CONFIG_FIELDS.map(({ key, label, example }) => (
        <Input
          key={key}
          label={label}
          placeholder={status?.config[key] || example}
          value={draft[key] ?? ''}
          onChange={(value) => set(configDraft, { ...read(configDraft), [key]: value })}
        />
      ))}
      <Input
        label="Correo admin del backend"
        placeholder={
          status?.backend ? 'Guardado — escribe otro para cambiarlo' : 'admin@ejemplo.com'
        }
        value={read(backendEmail)}
        onChange={(value) => set(backendEmail, value)}
      />
      <Input
        label="Contraseña admin del backend"
        type="password"
        value={read(backendPassword)}
        onChange={(value) => set(backendPassword, value)}
      />
      <Text muted size="xs">
        La URI y las credenciales se guardan cifradas en los secretos del plugin; el resto, en sus
        Ajustes. MercadoLibre usa la sesión de afiliados abierta en el navegador de Topo.
      </Text>
      <Button icon="check" onPress={save} disabled={!hasInput()}>
        Guardar conexiones
      </Button>
    </Stack>
  )
}
