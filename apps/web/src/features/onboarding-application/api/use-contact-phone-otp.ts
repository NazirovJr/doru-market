import { useCallback, useState } from 'react'
import type { SubmitChainApplicationRequest } from '@dorutj/contracts'
import { HttpError } from '@/shared/api/http-client'
import { requestContactPhoneOtp, submitChainApplication, verifyContactPhone } from './onboarding-application.api'

/**
 * `use-contact-phone-otp.ts` (DTJ-076, «Что сделать» §5) — React-обвязка над OTP-верификацией
 * контактного телефона.
 *
 * **Почему `PharmacyChain` создаётся ЗДЕСЬ, а не только на финальном сабмите.** OTP-эндпоинты
 * (`POST /pharmacy-chains/:id/request-contact-phone-otp`, `.../verify-contact-phone`) существуют
 * ТОЛЬКО на ресурсе `pharmacy-chains` (прочитан `pharmacy-chains-public.controller.ts` целиком) —
 * без `chainId` их вызвать нечем. Тикет требует OTP-шаг «после ввода телефона», т.е. ДО того, как
 * пользователь заполнил данные точки и нажал финальный «Отправить заявку» — поэтому первый клик
 * «Отправить код» лениво создаёт `PharmacyChain` (`POST /pharmacy-chains`, draft) ОДИН РАЗ,
 * запоминает `chainId` и переиспользует его для OTP и для финального шага (см. ДОПУЩЕНИЯ в отчёте
 * сдачи тикета — расхождение с буквальным прочтением п.6 «POST /pharmacy-chains ИЛИ
 * POST /pharmacy-accounts» как взаимоисключающих вызовов).
 *
 * `requestCode` принимает `buildChainPayload` ЛЕНИВО (не сам payload) — вызывается только если
 * `chainId` ещё не создан, чтобы не собирать payload из уже устаревшего состояния формы при
 * повторных нажатиях «Отправить код» (например, после `OTP_EXPIRED`).
 */

export type ContactPhoneOtpStatus = 'idle' | 'requesting' | 'code_sent' | 'verifying' | 'verified'

export interface UseContactPhoneOtpResult {
  readonly status: ContactPhoneOtpStatus
  readonly chainId: string | null
  readonly errorCode: string | null
  readonly requestCode: (buildChainPayload: () => SubmitChainApplicationRequest) => Promise<void>
  readonly verifyCode: (code: string) => Promise<boolean>
}

export function useContactPhoneOtp(): UseContactPhoneOtpResult {
  const [status, setStatus] = useState<ContactPhoneOtpStatus>('idle')
  const [chainId, setChainId] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const requestCode = useCallback(
    async (buildChainPayload: () => SubmitChainApplicationRequest): Promise<void> => {
      setStatus('requesting')
      setErrorCode(null)
      try {
        let resolvedChainId = chainId
        if (resolvedChainId === null) {
          const chain = await submitChainApplication(buildChainPayload())
          resolvedChainId = chain.id
          setChainId(resolvedChainId)
        }
        await requestContactPhoneOtp(resolvedChainId)
        setStatus('code_sent')
      } catch (err: unknown) {
        setStatus('idle')
        setErrorCode(err instanceof HttpError ? err.code : null)
      }
    },
    [chainId],
  )

  const verifyCode = useCallback(
    async (code: string): Promise<boolean> => {
      if (chainId === null) {
        return false
      }
      setStatus('verifying')
      setErrorCode(null)
      try {
        await verifyContactPhone(chainId, code)
        setStatus('verified')
        return true
      } catch (err: unknown) {
        // AC4: НЕВЕРНЫЙ код — назад к вводу кода (НЕ 'verified', форма не переходит дальше),
        // ошибка выставлена и покажется у поля.
        setStatus('code_sent')
        setErrorCode(err instanceof HttpError ? err.code : null)
        return false
      }
    },
    [chainId],
  )

  return { status, chainId, errorCode, requestCode, verifyCode }
}
