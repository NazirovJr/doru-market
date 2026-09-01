import { describe, expect, it } from 'vitest'
import {
  initialState,
  loginFlowReducer,
  MAX_VERIFY_ATTEMPTS,
  errorCodeToI18nKey,
  type LoginFlowState,
} from './login-flow.model'

describe('login-flow.model (DTJ-028)', () => {
  describe('reducer', () => {
    it('1. начальное состояние: step=phone, attemptsLeft=5', () => {
      expect(initialState.step).toBe('phone')
      expect(initialState.attemptsLeft).toBe(MAX_VERIFY_ATTEMPTS)
      expect(initialState.otpRequestId).toBeNull()
      expect(initialState.errorCode).toBeNull()
    })

    it('2. phoneSubmit: phone → code, resendCooldownSeconds=60', () => {
      const next = loginFlowReducer(initialState, {
        type: 'phoneSubmit',
        phone: '+992917123456',
        otpRequestId: 'req-1',
      })
      expect(next.step).toBe('code')
      expect(next.phone).toBe('+992917123456')
      expect(next.otpRequestId).toBe('req-1')
      expect(next.attemptsLeft).toBe(5)
      expect(next.resendCooldownSeconds).toBe(60)
      expect(next.errorCode).toBeNull()
    })

    it('3. codeMismatch: attemptsLeft 5→4, остаёмся в code', () => {
      const inCode = loginFlowReducer(initialState, {
        type: 'phoneSubmit',
        phone: '+992917123456',
        otpRequestId: 'req-1',
      })
      const next = loginFlowReducer(inCode, { type: 'codeMismatch' })
      expect(next.step).toBe('code')
      expect(next.attemptsLeft).toBe(4)
      expect(next.errorCode).toBe('OTP_MISMATCH')
    })

    it('4. codeMismatch: attemptsLeft НЕ уходит ниже 0 (defense-in-depth)', () => {
      let state: LoginFlowState = {
        ...initialState,
        step: 'code',
        otpRequestId: 'req-1',
        phone: '+992917123456',
      }
      for (let i = 0; i < 7; i += 1) {
        state = loginFlowReducer(state, { type: 'codeMismatch' })
      }
      expect(state.attemptsLeft).toBe(0)
    })

    it('5. codeExpired: step остаётся code, errorCode=OTP_EXPIRED', () => {
      const inCode: LoginFlowState = {
        ...initialState,
        step: 'code',
        otpRequestId: 'req-1',
        phone: '+992917123456',
      }
      const next = loginFlowReducer(inCode, { type: 'codeExpired' })
      expect(next.step).toBe('code')
      expect(next.errorCode).toBe('OTP_EXPIRED')
    })

    it('6. codeLocked: переход в locked, attemptsLeft=0', () => {
      const inCode: LoginFlowState = {
        ...initialState,
        step: 'code',
        otpRequestId: 'req-1',
        phone: '+992917123456',
      }
      const next = loginFlowReducer(inCode, { type: 'codeLocked' })
      expect(next.step).toBe('locked')
      expect(next.attemptsLeft).toBe(0)
      expect(next.errorCode).toBe('OTP_LOCKED')
    })

    it('7. goBackToPhone из locked → phone, attemptsLeft=5, cooldown=0', () => {
      const locked: LoginFlowState = {
        ...initialState,
        step: 'locked',
        otpRequestId: 'req-1',
        phone: '+992917123456',
        attemptsLeft: 0,
        errorCode: 'OTP_LOCKED',
      }
      const next = loginFlowReducer(locked, { type: 'goBackToPhone' })
      expect(next.step).toBe('phone')
      expect(next.otpRequestId).toBeNull()
      expect(next.attemptsLeft).toBe(5)
      expect(next.resendCooldownSeconds).toBe(0)
      expect(next.errorCode).toBeNull()
    })

    it('8. resendRequested из code → phone', () => {
      const inCode: LoginFlowState = {
        ...initialState,
        step: 'code',
        otpRequestId: 'req-1',
        phone: '+992917123456',
        resendCooldownSeconds: 60,
      }
      const next = loginFlowReducer(inCode, { type: 'resendRequested' })
      expect(next.step).toBe('phone')
      expect(next.resendCooldownSeconds).toBe(0)
    })

    it('9. tick: resendCooldownSeconds 3→2 (иммутабельно)', () => {
      const inCode: LoginFlowState = {
        ...initialState,
        step: 'code',
        otpRequestId: 'req-1',
        phone: '+992917123456',
        resendCooldownSeconds: 3,
      }
      const next = loginFlowReducer(inCode, { type: 'tick', now: new Date() })
      expect(next.resendCooldownSeconds).toBe(2)
      // Иммутабельность: старый объект не изменился
      expect(inCode.resendCooldownSeconds).toBe(3)
    })

    it('10. tick при resendCooldownSeconds=0 — no-op (state не меняется)', () => {
      const next = loginFlowReducer(initialState, { type: 'tick', now: new Date() })
      expect(next).toEqual(initialState)
    })

    it('11. tick в phone-step — не двигает шаг, только декремент cooldown', () => {
      const inPhone: LoginFlowState = { ...initialState, resendCooldownSeconds: 5 }
      const next = loginFlowReducer(inPhone, { type: 'tick', now: new Date() })
      expect(next.step).toBe('phone')
      expect(next.resendCooldownSeconds).toBe(4)
    })
  })

  describe('errorCodeToI18nKey', () => {
    it('12. OTP_MISMATCH → ux.error.otp_mismatch', () => {
      const m = errorCodeToI18nKey('OTP_MISMATCH')
      expect(m?.key).toBe('ux.error.otp_mismatch')
    })
    it('13. OTP_LOCKED → ux.error.otp_locked', () => {
      const m = errorCodeToI18nKey('OTP_LOCKED')
      expect(m?.key).toBe('ux.error.otp_locked')
    })
    it('14. OTP_EXPIRED → ux.error.otp_expired', () => {
      const m = errorCodeToI18nKey('OTP_EXPIRED')
      expect(m?.key).toBe('ux.error.otp_expired')
    })
    it('15. null → null (нет ошибки)', () => {
      expect(errorCodeToI18nKey(null)).toBeNull()
    })
    it('16. неизвестный код → ux.error.generic_500 (fallback)', () => {
      const m = errorCodeToI18nKey('SOMETHING_NEW')
      expect(m?.key).toBe('ux.error.generic_500')
    })
  })
})
