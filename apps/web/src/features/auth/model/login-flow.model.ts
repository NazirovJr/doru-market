/**
 * `login-flow.model.ts` (EP-01, DTJ-028, SRS-UX-002/014/017/018/019/023/027) —
 * чистый reducer состояний login-flow. ВНЕ React/Query/Zustand: только
 * discriminated-union и переходы. UI-слой (`phone-step.tsx`, `code-step.tsx`)
 * использует этот reducer как ЕДИНСТВЕННЫЙ источник истины о шагах,
 * счётчике попыток и cooldown-таймере для resend.
 *
 * Шаги:
 *   - `'phone'`   — ввод номера (начальное).
 *   - `'code'`    — ввод 6-значного OTP-кода.
 *   - `'locked'`  — сервер вернул `423 OTP_LOCKED`. UI обязан показать
 *                   кнопку «Запросить новый код» (НЕ таймер обратного отсчёта —
 *                   расхождение №2 из дизайна, см. DTJ-028 «Технический контекст»).
 *
 * `attemptsLeft` — КЛИЕНТСКАЯ ЭВРИСТИКА для UX, НЕ источник истины. Сервер
 * (DTJ-024) считает независимо. Рассинхрон возможен (две вкладки), и use
 * case ОБЯЗАН корректно реагировать на `423` от сервера даже если
 * клиентский счётчик ещё не дошёл до 5 (см. DTJ-028 «Риски»).
 *
 * `resendCooldownSeconds` — обратный отсчёт до разрешения повторного
 * `POST /auth/otp/request`. Стартует на `enterCode`, тикает каждую секунду
 * (UI вызывает `tick(now)` через `setInterval`).
 */

export const MAX_VERIFY_ATTEMPTS = 5 // SRS-API-022, дизайн-расхождение №1

export type LoginStep = 'phone' | 'code' | 'locked'

export interface LoginFlowState {
  readonly step: LoginStep
  readonly phone: string // E.164 (например, '+992XXXXXXXXX'); '' на старте
  readonly otpRequestId: string | null
  readonly attemptsLeft: number // 5..0; показывается в error-message `ux.error.otp_mismatch`
  readonly resendCooldownSeconds: number // 60..0; 0 = можно слать снова
  readonly errorCode: string | null // ErrorCode из @dorutj/contracts, для локализации текста
}

export type LoginFlowEvent =
  | { readonly type: 'phoneSubmit'; readonly phone: string; readonly otpRequestId: string }
  | { readonly type: 'codeMismatch' }
  | { readonly type: 'codeExpired' }
  | { readonly type: 'codeLocked' }
  | { readonly type: 'codeSuccess' }
  | { readonly type: 'resendRequested' }
  | { readonly type: 'tick'; readonly now: Date }
  | { readonly type: 'goBackToPhone' } // с 'locked' на 'phone' для повторного запроса

const RESEND_COOLDOWN_SECONDS = 60 // SRS-UX-014, синхронизировано с OTP_REQUEST_COOLDOWN_SECONDS на бэке

export const initialState: LoginFlowState = {
  step: 'phone',
  phone: '',
  otpRequestId: null,
  attemptsLeft: MAX_VERIFY_ATTEMPTS,
  resendCooldownSeconds: 0,
  errorCode: null,
}

export function loginFlowReducer(
  state: LoginFlowState,
  event: LoginFlowEvent,
): LoginFlowState {
  switch (event.type) {
    case 'phoneSubmit':
      return {
        ...state,
        step: 'code',
        phone: event.phone,
        otpRequestId: event.otpRequestId,
        attemptsLeft: MAX_VERIFY_ATTEMPTS,
        resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
        errorCode: null,
      }
    case 'codeMismatch':
      return {
        ...state,
        step: 'code',
        attemptsLeft: Math.max(0, state.attemptsLeft - 1),
        errorCode: 'OTP_MISMATCH',
      }
    case 'codeExpired':
      return {
        ...state,
        step: 'code',
        errorCode: 'OTP_EXPIRED',
      }
    case 'codeLocked':
      return {
        ...state,
        step: 'locked',
        attemptsLeft: 0,
        errorCode: 'OTP_LOCKED',
      }
    case 'codeSuccess':
      return {
        ...state,
        step: 'code',
        errorCode: null,
      }
    case 'resendRequested':
      return {
        ...state,
        step: 'phone',
        otpRequestId: null,
        attemptsLeft: MAX_VERIFY_ATTEMPTS,
        resendCooldownSeconds: 0,
        errorCode: null,
      }
    case 'goBackToPhone':
      return {
        ...state,
        step: 'phone',
        otpRequestId: null,
        attemptsLeft: MAX_VERIFY_ATTEMPTS,
        resendCooldownSeconds: 0,
        errorCode: null,
      }
    case 'tick':
      // Тик только если есть активный cooldown. Не трогаем другие поля —
      // это «уменьшение счётчика» с сохранением всего остального.
      if (state.resendCooldownSeconds <= 0) {
        return state
      }
      return { ...state, resendCooldownSeconds: state.resendCooldownSeconds - 1 }
  }
}

/**
 * Маппинг `ErrorCode` → i18n-ключ для UI. Изолировано в модели, чтобы
 * UI-слой (`code-step.tsx`) не зависел от контрактов напрямую и был
 * лёгок в тестировании.
 */
export function errorCodeToI18nKey(
  code: string | null,
): { key: string; params: Readonly<Record<string, string | number>> } | null {
  switch (code) {
    case 'OTP_MISMATCH':
      return { key: 'ux.error.otp_mismatch', params: { attemptsLeft: 0 } } // `attemptsLeft` подставляется в UI
    case 'OTP_EXPIRED':
      return { key: 'ux.error.otp_expired', params: {} }
    case 'OTP_LOCKED':
      return { key: 'ux.error.otp_locked', params: {} }
    case 'OTP_REQUEST_RATE_LIMITED':
      // Один ключ на все rate-limit ошибки (SMS-флуд). UI показывает
      // дополнительно поле с `remainingTtlSeconds` если есть.
      return { key: 'ux.error.otp_locked', params: {} }
    case 'INVALID_PHONE_FORMAT':
      return { key: 'ux.error.generic_500', params: {} } // Заглушка: на UI обрабатывается отдельно, до verify
    default:
      return code === null ? null : { key: 'ux.error.generic_500', params: {} }
  }
}
