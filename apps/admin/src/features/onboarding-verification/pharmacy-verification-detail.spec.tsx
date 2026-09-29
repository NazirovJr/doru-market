import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PharmacyVerificationDetailView } from './pharmacy-verification-detail'

const ID = '11111111-1111-4111-8111-111111111111'
const BLOB_URL = 'blob:http://localhost/scan'
const SCAN_LINK = '/api/v1/onboarding-documents/files/a.pdf?expires=1&signature=s'

function detail(licenseScan: { url: string; contentType: string } | null): unknown {
  return {
    data: {
      id: ID,
      name: 'Аптека Тест',
      addressText: 'Душанбе',
      phone: '+992900000001',
      status: 'pending_review',
      licenseNumber: 'L-1',
      licenseExpiryDate: '2030-01-01T00:00:00.000Z',
      pharmacistInChargeName: 'Тестов Т.',
      licenseScan,
    },
  }
}

function stubApi(licenseScan: { url: string; contentType: string } | null): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string) =>
    Promise.resolve(input.includes('onboarding-documents') ? new Response('%PDF-1.4') : new Response(JSON.stringify(detail(licenseScan)))),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderView(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PharmacyVerificationDetailView id={ID} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => BLOB_URL)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PharmacyVerificationDetailView (DTJ-442)', () => {
  it('показывает реквизиты и превью PDF-скана лицензии', async () => {
    stubApi({ url: SCAN_LINK, contentType: 'application/pdf' })
    renderView()

    await waitFor(() => { expect(screen.getByTestId('onboarding-document-preview')).toBeInTheDocument() })
    expect(screen.getByText('Аптека Тест')).toBeInTheDocument()
    expect(screen.getByText('2030-01-01')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-document-preview').querySelector('iframe')).toHaveAttribute('src', BLOB_URL)
  })

  it('для изображения рисует img', async () => {
    stubApi({ url: SCAN_LINK, contentType: 'image/png' })
    renderView()

    await waitFor(() => { expect(screen.getByTestId('onboarding-document-preview').querySelector('img')).not.toBeNull() })
  })

  it('без скана сообщает об отсутствии и не запрашивает файл', async () => {
    const fetchMock = stubApi(null)
    renderView()

    await waitFor(() => { expect(screen.getByText('Скан лицензии не приложен')).toBeInTheDocument() })
    expect(screen.queryByTestId('onboarding-document-preview')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ошибка загрузки заявки — alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))
    renderView()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })
})
