import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { ContactPhoneOtpStep } from './contact-phone-otp-step'

/**
 * `contact-phone-otp-step.spec.tsx` (DTJ-076, AC4) — «Given телефон введён, код запрошен, When
 * введён НЕВЕРНЫЙ код, Then показана ошибка, форма НЕ переходит к следующему шагу».
 */

const { t } = useT('ru')

describe('ContactPhoneOtpStep (DTJ-076, AC4)', () => {
  it('1. status=idle — кнопка «Отправить код» активна, поле кода не показано', () => {
    render(
      <ContactPhoneOtpStep
        status="idle"
        errorCode={null}
        canRequestCode
        onRequestCode={vi.fn()}
        onVerifyCode={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByTestId('onboarding-otp-request')).not.toBeDisabled()
    expect(screen.queryByTestId('onboarding-otp-code-input')).not.toBeInTheDocument()
  })

  it('2. canRequestCode=false (поля юрлица невалидны) — кнопка «Отправить код» задизейблена', () => {
    render(
      <ContactPhoneOtpStep
        status="idle"
        errorCode={null}
        canRequestCode={false}
        onRequestCode={vi.fn()}
        onVerifyCode={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByTestId('onboarding-otp-request')).toBeDisabled()
  })

  it('3. клик «Отправить код» вызывает onRequestCode', () => {
    const onRequestCode = vi.fn()
    render(
      <ContactPhoneOtpStep
        status="idle"
        errorCode={null}
        canRequestCode
        onRequestCode={onRequestCode}
        onVerifyCode={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('onboarding-otp-request'))
    expect(onRequestCode).toHaveBeenCalledTimes(1)
  })

  it('4. status=code_sent — показано поле ввода кода + кнопка «Подтвердить»', () => {
    render(
      <ContactPhoneOtpStep
        status="code_sent"
        errorCode={null}
        canRequestCode
        onRequestCode={vi.fn()}
        onVerifyCode={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByTestId('onboarding-otp-code-input')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-otp-verify')).toBeInTheDocument()
  })

  it('5. АС4 — НЕВЕРНЫЙ код: errorCode=OTP_MISMATCH при status=code_sent — ошибка показана, поле кода/кнопка «Подтвердить» ОСТАЮТСЯ (не переходит дальше, не «verified»)', () => {
    render(
      <ContactPhoneOtpStep
        status="code_sent"
        errorCode="OTP_MISMATCH"
        canRequestCode
        onRequestCode={vi.fn()}
        onVerifyCode={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByTestId('onboarding-otp-error')).toHaveTextContent('Неверный код')
    expect(screen.getByTestId('onboarding-otp-code-input')).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-otp-verified')).not.toBeInTheDocument()
  })

  it('6. ввод кода и клик «Подтвердить» вызывает onVerifyCode с введённым кодом', () => {
    const onVerifyCode = vi.fn()
    render(
      <ContactPhoneOtpStep
        status="code_sent"
        errorCode={null}
        canRequestCode
        onRequestCode={vi.fn()}
        onVerifyCode={onVerifyCode}
        t={t}
      />,
    )
    fireEvent.change(screen.getByTestId('onboarding-otp-code-input'), { target: { value: '123456' } })
    fireEvent.click(screen.getByTestId('onboarding-otp-verify'))
    expect(onVerifyCode).toHaveBeenCalledWith('123456')
  })

  it('7. кнопка «Подтвердить» задизейблена при коде короче 4 цифр', () => {
    render(
      <ContactPhoneOtpStep
        status="code_sent"
        errorCode={null}
        canRequestCode
        onRequestCode={vi.fn()}
        onVerifyCode={vi.fn()}
        t={t}
      />,
    )
    fireEvent.change(screen.getByTestId('onboarding-otp-code-input'), { target: { value: '12' } })
    expect(screen.getByTestId('onboarding-otp-verify')).toBeDisabled()
  })

  it('8. status=verified — показано подтверждение, ни поле кода, ни кнопка запроса не рендерятся', () => {
    render(
      <ContactPhoneOtpStep
        status="verified"
        errorCode={null}
        canRequestCode
        onRequestCode={vi.fn()}
        onVerifyCode={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByTestId('onboarding-otp-verified')).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-otp-request')).not.toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-otp-code-input')).not.toBeInTheDocument()
  })

  it('9. OTP_EXPIRED — локализованное сообщение «устарел»', () => {
    render(
      <ContactPhoneOtpStep
        status="code_sent"
        errorCode="OTP_EXPIRED"
        canRequestCode
        onRequestCode={vi.fn()}
        onVerifyCode={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByTestId('onboarding-otp-error')).toHaveTextContent('устарел')
  })
})
