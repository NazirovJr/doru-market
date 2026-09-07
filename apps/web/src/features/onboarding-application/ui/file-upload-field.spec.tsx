import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { FileUploadField } from './file-upload-field'
import * as api from '../api/onboarding-application.api'

/**
 * `file-upload-field.spec.tsx` (DTJ-076/431, AC3/AC5) — «Given файл лицензии 11 МБ выбран для
 * загрузки, When попытка загрузки, Then показана ошибка «файл слишком большой» ДО отправки всей
 * формы».
 *
 * DTJ-431: `FileUploadField` теперь обёртка над `FileDropzone` (`@dorutj/ui`) — нативный
 * `<input type="file">` скрыт (`aria-hidden`, `tabIndex=-1`, триггер выбора — кнопка `Button`) и
 * БЕЗ `data-testid` (у `FileDropzone` нет пропа для произвольного `data-testid` на входе,
 * известное ограничение публичного API компонента) — файл выбирается через `id={testId}`,
 * прокинутый в `FileDropzone`, ошибка — через `role="alert"` (`FileDropzoneError`), не через
 * прежние `${testId}-error`/`${testId}-preview` testid. Раньше принятый файл ЛЮБОГО типа
 * показывал текст с именем файла (`${testId}-preview`) — `FileDropzone` рисует превью ТОЛЬКО
 * для изображений (`<img>`, локальный `URL.createObjectURL`), для PDF превью не показывает —
 * зафиксированное расхождение (отчёт сдачи DTJ-431), тест 3 ниже адаптирован под PNG вместо PDF,
 * чтобы проверить путь «успешная загрузка + превью» на типе, который `FileDropzone` реально умеет
 * превьюировать.
 */

const { t } = useT('ru')

function makeFile(sizeBytes: number, type: string, name = 'document.pdf'): File {
  return new File([new Uint8Array(sizeBytes)], name, { type })
}

function getFileInput(testId: string): HTMLInputElement {
  const input = document.getElementById(testId)
  if (input === null || !(input instanceof HTMLInputElement)) {
    throw new Error(`file input #${testId} not found`)
  }
  return input
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FileUploadField (DTJ-076/431, AC3/AC5)', () => {
  it('1. файл 11 МБ (>10 МБ) — ошибка «слишком большой» ДО сети, uploadOnboardingDocument НЕ вызывается', async () => {
    const uploadSpy = vi.spyOn(api, 'uploadOnboardingDocument')
    const onUploaded = vi.fn()
    render(<FileUploadField label="Лицензия" value={null} onUploaded={onUploaded} t={t} testId="onboarding-license-scan-upload" />)

    const input = getFileInput('onboarding-license-scan-upload')
    fireEvent.change(input, { target: { files: [makeFile(11 * 1024 * 1024, 'application/pdf')] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('10 МБ')
    expect(uploadSpy).not.toHaveBeenCalled()
    expect(onUploaded).toHaveBeenCalledWith(null)
  })

  it('2. неверный MIME-тип (text/plain) — ошибка формата ДО сети', async () => {
    const uploadSpy = vi.spyOn(api, 'uploadOnboardingDocument')
    const onUploaded = vi.fn()
    render(<FileUploadField label="Лицензия" value={null} onUploaded={onUploaded} t={t} testId="onboarding-license-scan-upload" />)

    const input = getFileInput('onboarding-license-scan-upload')
    fireEvent.change(input, { target: { files: [makeFile(1024, 'text/plain', 'note.txt')] } })

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(uploadSpy).not.toHaveBeenCalled()
    expect(onUploaded).toHaveBeenCalledWith(null)
  })

  it('3. валидный PNG ≤10 МБ — загружается, onUploaded вызван с URL, превью (img) показано', async () => {
    vi.spyOn(api, 'uploadOnboardingDocument').mockResolvedValue({ url: 'https://cdn.example/scan.png' })
    const onUploaded = vi.fn()
    render(<FileUploadField label="Лицензия" value={null} onUploaded={onUploaded} t={t} testId="onboarding-license-scan-upload" />)

    const input = getFileInput('onboarding-license-scan-upload')
    fireEvent.change(input, { target: { files: [makeFile(1024, 'image/png', 'scan.png')] } })

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith('https://cdn.example/scan.png')
    })
    expect(screen.getByRole('img', { name: 'Лицензия' })).toHaveAttribute('src', 'https://cdn.example/scan.png')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('4. сетевая ошибка при загрузке — показана ошибка, onUploaded(null)', async () => {
    vi.spyOn(api, 'uploadOnboardingDocument').mockRejectedValue(new Error('network down'))
    const onUploaded = vi.fn()
    render(<FileUploadField label="Лицензия" value={null} onUploaded={onUploaded} t={t} testId="onboarding-license-scan-upload" />)

    const input = getFileInput('onboarding-license-scan-upload')
    fireEvent.change(input, { target: { files: [makeFile(1024, 'image/png', 'scan.png')] } })

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith(null)
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
