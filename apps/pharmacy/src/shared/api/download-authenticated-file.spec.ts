import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadAuthenticatedFile } from './download-authenticated-file'

function stubUrlObjectMethods(): { readonly createObjectURL: ReturnType<typeof vi.fn>; readonly revokeObjectURL: ReturnType<typeof vi.fn> } {
  const createObjectURL = vi.fn(() => 'blob:object-url')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
  return { createObjectURL, revokeObjectURL }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('downloadAuthenticatedFile', () => {
  it('скачивает файл через fetch + Blob и кликает по временной ссылке с заданным именем', async () => {
    // Тело ответа — строка, не `new Blob(...)`: глобальный `Blob` в jsdom-окружении не реализует
    // `.stream()`, который нужен нативному `Response` (undici) при построении тела — конструктор
    // падает `TypeError: object.stream is not a function` детерминированно (несовместимость
    // jsdom-Blob и Node-Response, а не флейк). Строка — валидный BodyInit в обоих рантаймах;
    // `response.blob()` в продуктовом коде всё равно возвращает настоящий Blob.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('content', { status: 200 }))))
    const { createObjectURL, revokeObjectURL } = stubUrlObjectMethods()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined)

    await downloadAuthenticatedFile('/api/v1/inventory-import-template', 'template.xlsx')

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:object-url')
  })

  it('бросает ошибку при неуспешном ответе, не создаёт ссылку на скачивание', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))))
    const { createObjectURL } = stubUrlObjectMethods()

    await expect(downloadAuthenticatedFile('/api/v1/inventory-import-template', 'template.xlsx')).rejects.toThrow('HTTP 404')
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
