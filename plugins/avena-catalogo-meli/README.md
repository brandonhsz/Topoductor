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
- **En lote**: «Aplicar cambios de precio» escribe los cambios de precio, los precios que faltaban y
  los links compartidos cuyo precio en MercadoLibre cambió. «Aplicar precios de ML a todos» incluye
  además los saltos mayores a 50% y los de identidad dudosa, tras una advertencia.

- **Tareas programadas**: sincronizar, leer precios, aplicar cambios, «Actualizar precios» (leer y
  aplicar en un solo turno), generar referidos, buscar reemplazos y procesar pedidos, en los días
  y horas que elijas o cada N horas. Corren dentro de Topo mientras el plugin esté activo.
- **Cola de MercadoLibre**: todo lo que usa el navegador corre de a uno. Un segundo worker espera
  a que termine el primero (reserva en la base local que se renueva mientras corre).
- **Compras**: procesa pedidos (por ahora de una cola de prueba) en modo prueba (hasta la pantalla
  de pago) o real (con tope). Cada sesión de compra termina borrando el domicilio del pedido y
  dejando el carrito vacío.

## Aprendizajes de MercadoLibre

Lo que aprendimos operando el catálogo y comprando de verdad; cada punto ya está aplicado en el
código.

- **Leer precios no necesita cuenta.** Precios y tarjetas de `meli.la` son públicos: la lectura
  solo necesita una página de `www.mercadolibre.com.mx` (los iframes exigen ese origen). Solo
  **generar** referidos necesita la cuenta de afiliados, en el generador de links.
- **El mismo navegador no puede tener dos cuentas.** Si alguien entra con la cuenta de compras, se
  pierde la de afiliados (y al revés). Por eso leer no depende de ninguna.
- **El contador del carrito miente**: el ícono cuenta solo los productos seleccionados. El carrito
  se lee en su página, en sus dos pestañas (`?hub_selected=gm_cart` y `?hub_selected=full_super`).
  En vista angosta cada producto tiene dos botones «Eliminar producto».
- **Totales**: ML escribe «Total $ 1.691 , 75 $ 913 , 12» (tachado, luego el que se paga; centavos
  aparte). Se toma el último monto con sus centavos.
- **Checkout real**: carrito «Continuar (N)» (es un enlace), formulario de domicilio con Colonia
  como lista por CP, «Revisa la dirección» (mapa), «Cuéntanos más» (tipo de lugar obligatorio),
  resumen con «Pagar y finalizar». Las mensualidades viven en un iframe: se eligen con el
  snapshot de accesibilidad de Topo. El resumen no muestra el CP: se valida calle y número.
- **Productos FULL Súper** suelen no tener «Comprar ahora»: solo se compran por carrito, y solo con
  el carrito vacío para no arrastrar otros productos.
- **Pausas humanas**: captcha y la validación del banco (3-D Secure, p. ej. SuperToken) los hace una
  persona; el flujo trae la pestaña al frente, avisa y espera. MercadoLibre también puede meter
  ofertas (Meli+) a media compra: el flujo se detiene ante una pantalla desconocida.
- **Precios desfasados cuestan dinero**: un salto grande hacia arriba sin aplicar dejó vender a
  $424 algo que costaba $900. «Actualizar precios» aplica los saltos hacia arriba; las bajadas
  grandes y otras presentaciones esperan revisión.

## Configuración

Nada específico de una empresa vive en el código: todo se captura en Topo, desde el formulario
**Conexiones** del panel o en Ajustes → Plugins.

| Qué                                               | Dónde se guarda     |
| ------------------------------------------------- | ------------------- |
| URI de Mongo (usuario de solo lectura)            | Secretos del plugin |
| Base, colección y owner de los productos          | Ajustes del plugin  |
| URL del backend y ruta del endpoint de escritura  | Ajustes del plugin  |
| Correo y contraseña de un admin del backend       | Secretos del plugin |
| Sesión de afiliados (solo para generar referidos) | Navegador de Topo   |

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
