import type { TranslateFunction } from '@dorutj/i18n'
import type { CheckoutFormState } from './checkout-form.model'

/**
 * `compose-delivery-landmark.ts` (DTJ-235, «Что сделать» §3) — сетка подъезд/этаж/квартира не
 * имеет отдельных колонок в БД (тикет: «сохраняются в `deliveryLandmark`/структурированное
 * текстовое поле, не отдельные колонки БД — см. DTJ-229»; `CreateOrderRequestSchema`,
 * `apps/api/.../create-order-request.dto.ts`, прочитан целиком — поля `entrance`/`floor`/
 * `apartment` в схеме ДЕЙСТВИТЕЛЬНО отсутствуют) — эта функция складывает их в ОДНУ строку
 * ориентира перед отправкой.
 *
 * `t: TranslateFunction` — намеренно параметр, НЕ импорт `useT()` внутрь (функция остаётся
 * чистой/тестируемой мок-функцией `t`, тот же приём, что `cart-screen.tsx#
 * resolveMutationErrorMessage(error, t)`). Подписи «Подъезд»/«Этаж»/«Квартира» в составленной
 * строке — из УЖЕ СУЩЕСТВУЮЩИХ ключей плейсхолдеров полей сетки
 * (`checkout.address.entrance_placeholder` и т.д.), не отдельные новые ключи: курьер читает
 * ориентир в ТОМ ЖЕ языке, в котором покупатель заполнял форму (переключение локали посреди
 * формы, SRS-UX-054, не меняет уже введённые значения — но следующий рендер этой функции
 * использует ТЕКУЩИЙ `t`, поэтому итоговая строка всегда на языке отправки, а не языке ввода).
 */
export function composeDeliveryLandmark(
  fields: Pick<CheckoutFormState, 'landmark' | 'entrance' | 'floor' | 'apartment'>,
  t: TranslateFunction,
): string | null {
  const landmark = fields.landmark.trim()
  const parts = [
    landmark.length > 0 ? landmark : null,
    formatLabeledPart(t('checkout.address.entrance_placeholder'), fields.entrance),
    formatLabeledPart(t('checkout.address.floor_placeholder'), fields.floor),
    formatLabeledPart(t('checkout.address.apartment_placeholder'), fields.apartment),
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join('; ') : null
}

/** Не мутирует аргументы (C13) — возвращает готовый фрагмент или `null`, накопление — через
 *  `.filter()` в `composeDeliveryLandmark`, не через `push()` в параметр-аккумулятор. */
function formatLabeledPart(label: string, rawValue: string): string | null {
  const value = rawValue.trim()
  return value.length > 0 ? `${label}: ${value}` : null
}
