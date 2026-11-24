// The checkout pages after «Comprar ahora» or the cart, walked one at a time. Test mode goes as far
// as the payment screen and stops there: it never chooses a payment method nor confirms.
import type { CheckoutRequest, CheckoutResult } from './checkout-browser'
import {
  addressFormExpression,
  CHECKOUT_STATE_EXPRESSION,
  CONFIRM_EXPRESSION,
  CONTINUE_EXPRESSION,
  MAP_CONFIRM_EXPRESSION,
  SAVE_ADDRESS_EXPRESSION,
  SKIP_DETAILS_EXPRESSION
} from './checkout-scripts'
import { amount, field, text } from './json-fields'
import type { OrderAddress } from './schedule-types'

const MAX_STEPS = 10

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether the review names the order's street and number (it does not show the postal code). */
export function showsAddress(pageText: string, address: OrderAddress): boolean {
  return normalize(pageText).includes(normalize(`${address.street} ${address.number}`))
}

export type StepContext = {
  /** The request with its cap already fixed. */
  request: CheckoutRequest & { maxTotal: number }
  step(expression: string): Promise<unknown>
  pause(): Promise<void>
  /** Waits for a person to solve a captcha; `false` when nobody did in time. */
  passVerification(): Promise<boolean>
}

export async function walkCheckout(ctx: StepContext): Promise<CheckoutResult> {
  const { request } = ctx
  const stop = (stage: string, message: string, total: number | null = null): CheckoutResult => ({
    stage,
    total,
    orderNumber: null,
    message
  })
  const act = async (stage: string, expression: string, failure: string) => {
    const done = await ctx.step(expression)
    return field(done, 'ok') === true ? null : stop(stage, text(field(done, 'message')) ?? failure)
  }
  let addressDone = false
  for (let index = 0; index < MAX_STEPS; index++) {
    const state = await ctx.step(CHECKOUT_STATE_EXPRESSION)
    const step = text(field(state, 'step')) ?? 'desconocido'
    const total = amount(field(state, 'total'))
    let failed: CheckoutResult | null = null
    if (step === 'comprado') {
      return {
        stage: 'comprado',
        total,
        orderNumber: text(field(state, 'orderNumber')),
        message: 'Compra confirmada'
      }
    } else if (step === 'verificacion') {
      if (!(await ctx.passVerification())) {
        return stop(step, 'MercadoLibre pidió verificación de la cuenta y nadie la completó')
      }
      continue
    } else if (step === 'pago') {
      return stop(step, 'Falta elegir o guardar un medio de pago en la cuenta')
    } else if (step === 'domicilio') {
      if (addressDone) {
        return stop(step, 'MercadoLibre no aceptó el domicilio')
      }
      failed =
        (await act(
          step,
          addressFormExpression(request.address),
          'No se pudo llenar el domicilio'
        )) ?? (await act(step, SAVE_ADDRESS_EXPRESSION, 'No se pudo guardar el domicilio'))
      addressDone = true
    } else if (step === 'mapa') {
      failed = await act(step, MAP_CONFIRM_EXPRESSION, 'No se pudo confirmar la dirección')
    } else if (step === 'detalles') {
      failed = await act(step, SKIP_DETAILS_EXPRESSION, 'No se pudo omitir los detalles')
    } else if (step === 'resumen') {
      if (total === null) {
        return stop(step, 'No se pudo leer el total del resumen')
      }
      // A saved address of the account would skip the form: never confirm another address.
      if (!showsAddress(text(field(state, 'text')) ?? '', request.address)) {
        return stop(step, 'El resumen no muestra el domicilio del pedido', total)
      }
      if (total > request.maxTotal) {
        return stop(step, `El total $${total} supera el tope $${request.maxTotal}`, total)
      }
      if (request.mode === 'prueba') {
        return {
          ...stop(
            step,
            `Llegó a la pantalla de pago por $${total}: se detuvo antes de elegir medio de pago (modo prueba: no se compró)`,
            total
          ),
          testPassed: true
        }
      }
      if (field(state, 'paymentChosen') !== true) {
        return stop('pago', 'No hay un medio de pago elegido: se detuvo sin pagar', total)
      }
      failed = await act(step, CONFIRM_EXPRESSION, 'No se pudo confirmar la compra')
    } else if (step === 'continuar') {
      await ctx.step(CONTINUE_EXPRESSION)
    } else {
      return stop(step, `Paso del checkout no reconocido (${text(field(state, 'path')) ?? ''})`)
    }
    if (failed) {
      return failed
    }
    await ctx.pause()
  }
  return stop('checkout', 'El checkout no terminó en los pasos esperados')
}
