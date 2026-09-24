import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { TenantDetailDto } from '@dorutj/contracts'
import { TenantSettingsForm } from './tenant-settings-form'

const DETAIL: TenantDetailDto = {
  id: 'tenant-1',
  slug: 'apteka-vasco',
  isNeutral: false,
  customDomain: null,
  brandName: 'Vasco',
  brandLogoUrl: null,
  brandPalette: { '--brand-primary': '#123456' },
  codLimitDiram: 50_000,
  holdPeriodDays: 1,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function patchCalls(fetchMock: ReturnType<typeof vi.fn<FetchImpl>>): unknown[] {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
}

async function renderForm(patchImpl: () => Promise<Response>): Promise<ReturnType<typeof vi.fn<FetchImpl>>> {
  const fetchMock = stubFetch((_url, init) =>
    init?.method === 'PATCH' ? patchImpl() : Promise.resolve(jsonResponse({ data: DETAIL })),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/tenants/tenant-1']}>
        <Routes>
          <Route path="/admin/tenants/:tenantId" element={<TenantSettingsForm />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await waitFor(() => { expect(screen.getByTestId('tenant-settings-form')).toBeInTheDocument() })
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TenantSettingsForm', () => {
  it('невалидный HEX блокирует отправку инлайн-ошибкой, PATCH не уходит', async () => {
    const fetchMock = await renderForm(() => Promise.resolve(jsonResponse({ data: DETAIL })))

    fireEvent.change(screen.getByLabelText('Основной цвет (HEX)'), { target: { value: 'not-a-hex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('Цвет должен быть в формате HEX, например #1A2B3C')).toBeInTheDocument()
    expect(patchCalls(fetchMock)).toHaveLength(0)
  })

  it('отрицательный codLimitDiram блокирует отправку инлайн-ошибкой, PATCH не уходит', async () => {
    const fetchMock = await renderForm(() => Promise.resolve(jsonResponse({ data: DETAIL })))

    fireEvent.change(screen.getByLabelText('Лимит наложенного платежа, дирам'), { target: { value: '-100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('Лимит наложенного платежа должен быть целым числом не меньше 0')).toBeInTheDocument()
    expect(patchCalls(fetchMock)).toHaveLength(0)
  })

  it('валидная форма отправляет PATCH, успех показывает тост', async () => {
    const fetchMock = await renderForm(() => Promise.resolve(jsonResponse({ data: { ...DETAIL, brandName: 'Renamed' } })))

    fireEvent.change(screen.getByLabelText('Название бренда'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => { expect(patchCalls(fetchMock)).toHaveLength(1) })
    expect(await screen.findByText('Настройки тенанта сохранены')).toBeInTheDocument()
  })

  it('ответ 400 от сервера показывает текст ошибки, не сырой JSON', async () => {
    const fetchMock = await renderForm(() =>
      Promise.resolve(jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'Некорректное имя бренда' } }, 400)),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    const errorText = await screen.findByText('Некорректное имя бренда')
    expect(errorText).toBeInTheDocument()
    expect(screen.queryByText(/\{"error"/)).not.toBeInTheDocument()
    expect(patchCalls(fetchMock)).toHaveLength(1)
  })
})
