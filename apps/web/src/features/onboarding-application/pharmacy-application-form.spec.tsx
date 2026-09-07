import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { PharmacyApplicationForm } from './pharmacy-application-form'
import * as api from './api/onboarding-application.api'

/**
 * `pharmacy-application-form.spec.tsx` (DTJ-076) — тест-план тикета, сценарии 1–2, 5:
 * 1. соло-заявка без `isWhitelabelRequested` — успешная отправка, оба API-вызова точки выполнены
 *    последовательно, экран успеха показан (AC1).
 * 2. `isWhitelabelRequested=true` БЕЗ `legalAddress` — отправка заблокирована, локализованная
 *    ошибка у поля (AC2).
 * 5. защита от двойной отправки — второй клик не отправляет второй запрос (AC5).
 */

const CHAIN_ID = '11111111-1111-4111-8111-111111111111'
const PHARMACY_ID = 'acc-1'

function renderForm(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LocaleProvider>
        <PharmacyApplicationForm />
      </LocaleProvider>
    </MemoryRouter>,
  )
}

function fillLegalSection(): void {
  fireEvent.change(screen.getByTestId('onboarding-legal-entity-name'), { target: { value: 'Фарм Сервис' } })
  fireEvent.change(screen.getByTestId('onboarding-tin-inn'), { target: { value: '123456789' } })
  fireEvent.change(screen.getByTestId('onboarding-director-full-name'), { target: { value: 'Иванов Иван' } })
  fireEvent.change(screen.getByTestId('onboarding-contact-phone'), { target: { value: '+992901234567' } })
}

function fillPharmacySection(): void {
  fireEvent.change(screen.getByTestId('onboarding-pharmacy-name'), { target: { value: 'Аптека на Рудаки' } })
  fireEvent.change(screen.getByTestId('onboarding-pharmacy-address'), { target: { value: 'ул. Рудаки, 12' } })
  fireEvent.change(screen.getByTestId('onboarding-license-number'), { target: { value: 'LIC-001' } })
  fireEvent.change(screen.getByTestId('onboarding-license-expiry-date'), { target: { value: '2030-01-01' } })
  fireEvent.change(screen.getByTestId('onboarding-pharmacist-in-charge'), { target: { value: 'Каримова Зарина' } })
}

async function completeOtpVerification(): Promise<void> {
  fireEvent.click(screen.getByTestId('onboarding-otp-request'))
  await screen.findByTestId('onboarding-otp-code-input')
  fireEvent.change(screen.getByTestId('onboarding-otp-code-input'), { target: { value: '123456' } })
  fireEvent.click(screen.getByTestId('onboarding-otp-verify'))
  await screen.findByTestId('onboarding-otp-verified')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PharmacyApplicationForm (DTJ-076)', () => {
  it('1. соло-заявка без isWhitelabelRequested — успешная отправка, экран успеха с id заявки (AC1)', async () => {
    vi.spyOn(api, 'submitChainApplication').mockResolvedValue({ id: CHAIN_ID, status: 'draft' })
    vi.spyOn(api, 'requestContactPhoneOtp').mockResolvedValue({ sent: true })
    vi.spyOn(api, 'verifyContactPhone').mockResolvedValue({ id: CHAIN_ID, verified: true })
    const submitPharmacyApplicationSpy = vi
      .spyOn(api, 'submitPharmacyApplication')
      .mockResolvedValue({ id: PHARMACY_ID, chainId: CHAIN_ID, status: 'draft' })
    const submitPharmacyForReviewSpy = vi
      .spyOn(api, 'submitPharmacyForReview')
      .mockResolvedValue({ id: PHARMACY_ID, status: 'pending_review' })
    const submitChainForReviewSpy = vi
      .spyOn(api, 'submitChainForReview')
      .mockResolvedValue({ id: CHAIN_ID, status: 'pending_review' })

    renderForm()
    fillLegalSection()
    await completeOtpVerification()
    fillPharmacySection()

    fireEvent.click(screen.getByTestId('pharmacy-application-submit'))

    await screen.findByTestId('pharmacy-application-success')
    expect(screen.getByTestId('pharmacy-application-success-id')).toHaveTextContent(PHARMACY_ID)

    // AC1: создание точки → перевод в pending_review выполнены ПОСЛЕДОВАТЕЛЬНО (и сеть тоже
    // переведена — см. JSDoc pharmacy-application-form.tsx, ДОПУЩЕНИЯ отчёта сдачи).
    expect(submitPharmacyApplicationSpy).toHaveBeenCalledWith(expect.objectContaining({ chainId: CHAIN_ID, name: 'Аптека на Рудаки' }))
    expect(submitPharmacyForReviewSpy).toHaveBeenCalledWith(PHARMACY_ID)
    expect(submitChainForReviewSpy).toHaveBeenCalledWith(CHAIN_ID)
  })

  it('2. isWhitelabelRequested=true БЕЗ legalAddress — отправка заблокирована, локализованная ошибка у поля (AC2)', () => {
    const submitChainApplicationSpy = vi.spyOn(api, 'submitChainApplication')
    const submitPharmacyApplicationSpy = vi.spyOn(api, 'submitPharmacyApplication')

    renderForm()
    fillLegalSection()
    fireEvent.click(screen.getByTestId('onboarding-whitelabel-toggle'))
    // registrationCertificateUrl тоже не заполнен — AC2 проверяет именно legalAddress.
    fillPharmacySection()

    fireEvent.click(screen.getByTestId('pharmacy-application-submit'))

    const legalAddressInput = screen.getByTestId('onboarding-legal-address')
    const errorNode = legalAddressInput.closest('div')?.querySelector('[role="alert"]')
    expect(errorNode).not.toBeNull()
    // `LocaleProvider` дефолтит на `tj` (SRS-UX-027, дефолт платформы) — сообщение локализовано.
    expect(errorNode).toHaveTextContent('Ин майдонро пур кунед')

    // Ни один сетевой вызов не ушёл — форма заблокирована ДО отправки.
    expect(submitChainApplicationSpy).not.toHaveBeenCalled()
    expect(submitPharmacyApplicationSpy).not.toHaveBeenCalled()
  })

  it('5. защита от двойной отправки — второй клик по кнопке (пока первый запрос ещё не завершился) НЕ создаёт вторую заявку (AC5)', async () => {
    vi.spyOn(api, 'submitChainApplication').mockResolvedValue({ id: CHAIN_ID, status: 'draft' })
    vi.spyOn(api, 'requestContactPhoneOtp').mockResolvedValue({ sent: true })
    vi.spyOn(api, 'verifyContactPhone').mockResolvedValue({ id: CHAIN_ID, verified: true })

    let resolveSubmit: (() => void) | undefined
    const submitPharmacyApplicationSpy = vi.spyOn(api, 'submitPharmacyApplication').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = () => { resolve({ id: PHARMACY_ID, chainId: CHAIN_ID, status: 'draft' }) }
        }),
    )
    vi.spyOn(api, 'submitPharmacyForReview').mockResolvedValue({ id: PHARMACY_ID, status: 'pending_review' })
    vi.spyOn(api, 'submitChainForReview').mockResolvedValue({ id: CHAIN_ID, status: 'pending_review' })

    renderForm()
    fillLegalSection()
    await completeOtpVerification()
    fillPharmacySection()

    const submitButton = screen.getByTestId('pharmacy-application-submit')
    fireEvent.click(submitButton)
    fireEvent.click(submitButton) // двойной клик — второй ДО того, как первый запрос разрешился

    await waitFor(() => { expect(submitButton).toBeDisabled() })
    expect(submitPharmacyApplicationSpy).toHaveBeenCalledTimes(1)

    resolveSubmit?.()
    await screen.findByTestId('pharmacy-application-success')
    expect(submitPharmacyApplicationSpy).toHaveBeenCalledTimes(1)
  })
})
