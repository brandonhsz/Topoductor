# Catálogo MercadoLibre

Panel de Topo para revisar productos guardados en Mongo que se venden con link de MercadoLibre,
y mantener al día sus precios y links de afiliado, uno por uno o en lote.

## Qué hace

- **Sincronizar base**: trae de Mongo los productos del owner configurado con `productURL` en
  `meli.la` o `mercadolibre.com.mx`.
- **Leer precios en ML**: abre cada `meli.la` en la pestaña de MercadoLibre del navegador de
  Topo y lee la tarjeta destacada (precio que paga el cliente, precio de lista, descuento,
  vendedor, id ML). Si la tarjeta no aparece, el link está roto.
- **Clasificar** cada producto: al día, cambio de precio, sin precio guardado, salto mayor a 50%,
  identidad dudosa (la marca no aparece en el título de ML), link compartido, roto o sin
  referido.
- **Por producto**: leer su precio, aplicarlo, generar el referido de una URL de ML (queda como
  propuesta hasta guardarlo), guardar una URL tal cual y prender o apagar el stock.
- **En lote**: aplicar solo los cambios de precio seguros (cambio de precio y sin precio guardado).
  Los saltos, los links compartidos y los de identidad dudosa esperan a una persona.

## Configuración

Nada específico de una empresa vive en el código: todo se captura en Topo, desde el formulario
**Conexiones** del panel o en Ajustes → Plugins.

| Qué                                              | Dónde se guarda     |
| ------------------------------------------------ | ------------------- |
| URI de Mongo (usuario de solo lectura)           | Secretos del plugin |
| Base, colección y owner de los productos         | Ajustes del plugin  |
| URL del backend y ruta del endpoint de escritura | Ajustes del plugin  |
| Correo y contraseña de un admin del backend      | Secretos del plugin |
| Sesión de afiliados de MercadoLibre              | Navegador de Topo   |

La URI de Mongo se prueba antes de guardarse; si pegas el host de un nodo de Atlas con
`mongodb+srv://`, el plugin lo cambia por el host del clúster.

El endpoint recibe `PATCH` con Basic auth y un arreglo de
`{ id, price?, productURL?, hasStock?, listPrice?, discountPercentage?, mlItemId?, priceCheckedAt? }`.
Los documentos de Mongo deben tener `owner`, `productURL`, `price`, `name`, `brand` y, opcionales,
`deletedDate`, `hasStock`, `listPrice`, `discountPercentage`, `mlItemId`, `priceCheckedAt` y
`adjustmentMarginPercentage`.

El worker usa el CLI de Topo para manejar el navegador; en macOS lo encuentra solo, en otros
sistemas pon su ruta en Ajustes.

## Base local

El worker guarda el catálogo en un archivo SQLite (`node:sqlite`, incluido en el Node de Topo;
no hay dependencias nativas):

| Tabla               | Qué guarda                                                                  |
| ------------------- | --------------------------------------------------------------------------- |
| `products`          | El estado actual de cada producto: lectura, propuesta de referido y estatus |
| `readings`          | Cada lectura de precio en MercadoLibre, con fecha (historial)               |
| `referral_attempts` | Cada intento de referido, con el link generado o el motivo del rechazo      |

Por defecto vive en la carpeta de datos del usuario (`~/Library/Application Support/topo-catalogo-mercadolibre/catalog.db`
en macOS, `%USERPROFILE%\AppData\Roaming\…` en Windows, `~/.local/share/…` en Linux); el ajuste
**Ruta de la base local** la cambia. El panel no carga el catálogo: pide al worker la página
filtrada y ordenada que muestra, y el historial del producto seleccionado. Lo que versiones
anteriores guardaban en el almacenamiento del plugin se migra a la base la primera vez.

## Desarrollo

```sh
topo plugin dev load plugins/avena-catalogo-meli --json
topo plugin test plugins/avena-catalogo-meli --json
topo plugin check plugins/avena-catalogo-meli --json
```

`vendor/mongodb.mjs` es el driver de MongoDB empaquetado (los plugins no llevan
`node_modules`). Para actualizarlo: `npm i mongodb@6` en una carpeta temporal y
`node scripts/vendor-mongodb.mjs <esa carpeta>`.
