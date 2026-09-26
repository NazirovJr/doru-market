/**
 * `file-dropzone.spec.tsx` (DTJ-410, тест-план тикета).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { FileDropzone, validateFile } from './file-dropzone'

const { t } = useT('ru')

const BYTES_PER_MB = 1024 * 1024

const createFile = (name: string, type: string, sizeBytes: number): File => {
  const file = new File([''], name, { type })
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

afterEach(() => {
  cleanup()
})

describe('validateFile — клиентская пре-валидация', () => {
  it('принимает файл, совпадающий с accept и не превышающий maxSizeMb', () => {
    const file = createFile('recipe.jpg', 'image/jpeg', 1 * BYTES_PER_MB)
    expect(validateFile(file, 'image/*', 10)).toEqual({ valid: true })
  })

  it('отклоняет несовпадающий MIME-тип', () => {
    const file = createFile('report.pdf', 'application/pdf', 1 * BYTES_PER_MB)
    const result = validateFile(file, 'image/*', 10)
    expect(result.valid).toBe(false)
    expect(result.errorKey).toBe('ui.file_dropzone.error_invalid_type')
  })

  it('отклоняет файл, превышающий maxSizeMb', () => {
    const file = createFile('recipe.jpg', 'image/jpeg', 15 * BYTES_PER_MB)
    const result = validateFile(file, 'image/*', 10)
    expect(result.valid).toBe(false)
    expect(result.errorKey).toBe('ui.file_dropzone.error_too_large')
    expect(result.errorParams).toEqual({ maxSizeMb: 10 })
  })

  it('поддерживает шаблон расширений (`.xlsx,.csv`), не только MIME', () => {
    const file = createFile('остатки.xlsx', '', 1 * BYTES_PER_MB)
    expect(validateFile(file, '.xlsx,.csv', 10).valid).toBe(true)
    const wrongExtension = createFile('остатки.pdf', '', 1 * BYTES_PER_MB)
    expect(validateFile(wrongExtension, '.xlsx,.csv', 10).valid).toBe(false)
  })

  it('поддерживает точный список MIME-типов через запятую (не только wildcard)', () => {
    const jpeg = createFile('recipe.jpg', 'image/jpeg', 1 * BYTES_PER_MB)
    expect(validateFile(jpeg, 'image/jpeg,image/png', 10).valid).toBe(true)
    const webp = createFile('recipe.webp', 'image/webp', 1 * BYTES_PER_MB)
    expect(validateFile(webp, 'image/jpeg,image/png', 10).valid).toBe(false)
  })
})

describe('FileDropzone — критерий приёмки 3 (пре-валидация размера ДО отправки)', () => {
  it('перетаскивание файла 15 МБ показывает error-состояние и НЕ вызывает onUpload', () => {
    const onUpload = vi.fn()
    render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={onUpload} />)

    const file = createFile('recipe.jpg', 'image/jpeg', 15 * BYTES_PER_MB)
    const dropzone = screen.getByTestId('dorutj-file-dropzone')
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    expect(dropzone).toHaveAttribute('data-state', 'error')
    expect(screen.getByTestId('dorutj-file-dropzone-error')).toHaveTextContent(
      t('ui.file_dropzone.error_too_large', { maxSizeMb: 10 }),
    )
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('несовпадение accept тоже блокируется клиентски с понятным текстом', () => {
    const onUpload = vi.fn()
    render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={onUpload} />)

    const file = createFile('report.pdf', 'application/pdf', 1 * BYTES_PER_MB)
    fireEvent.drop(screen.getByTestId('dorutj-file-dropzone'), { dataTransfer: { files: [file] } })

    expect(screen.getByTestId('dorutj-file-dropzone-error')).toHaveTextContent(
      t('ui.file_dropzone.error_invalid_type'),
    )
    expect(onUpload).not.toHaveBeenCalled()
  })
})

describe('FileDropzone — drag-and-drop и кнопка «Выбрать файл» дают идентичный результат', () => {
  it('валидный файл вызывает onUpload с тем же файлом обоими путями', () => {
    const onUploadViaDrag = vi.fn()
    const onUploadViaButton = vi.fn()
    const file = createFile('recipe.jpg', 'image/jpeg', 1 * BYTES_PER_MB)

    const { unmount } = render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={onUploadViaDrag} />)
    fireEvent.drop(screen.getByTestId('dorutj-file-dropzone'), { dataTransfer: { files: [file] } })
    expect(onUploadViaDrag).toHaveBeenCalledWith(file)
    unmount()

    render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={onUploadViaButton} />)
    fireEvent.change(screen.getByTestId('dorutj-file-dropzone-input'), { target: { files: [file] } })
    expect(onUploadViaButton).toHaveBeenCalledWith(file)

    expect(onUploadViaDrag.mock.calls).toEqual(onUploadViaButton.mock.calls)
  })

  it('невалидный файл даёт одинаковую ошибку обоими путями', () => {
    const file = createFile('recipe.jpg', 'image/jpeg', 15 * BYTES_PER_MB)

    const { unmount } = render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={vi.fn()} />)
    fireEvent.drop(screen.getByTestId('dorutj-file-dropzone'), { dataTransfer: { files: [file] } })
    const dragErrorText = screen.getByTestId('dorutj-file-dropzone-error').textContent
    unmount()

    render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={vi.fn()} />)
    fireEvent.change(screen.getByTestId('dorutj-file-dropzone-input'), { target: { files: [file] } })
    const buttonErrorText = screen.getByTestId('dorutj-file-dropzone-error').textContent

    expect(dragErrorText).toBe(buttonErrorText)
  })
})

describe('FileDropzone — внешняя (серверная) ошибка (errorKey) приоритетнее клиентской', () => {
  it('errorKey проп рендерится даже без взаимодействия пользователя', () => {
    render(
      <FileDropzone
        t={t}
        accept="image/*"
        maxSizeMb={10}
        onUpload={vi.fn()}
        errorKey="ux.error.image_illegible"
      />,
    )
    expect(screen.getByTestId('dorutj-file-dropzone-error')).toHaveTextContent(t('ux.error.image_illegible'))
  })
})

describe('FileDropzone — состояние uploading (прогресс)', () => {
  it('uploadProgressPercent рендерит ProgressBar с процентом', () => {
    render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={vi.fn()} uploadProgressPercent={42} />)
    expect(screen.getByTestId('dorutj-file-dropzone')).toHaveAttribute('data-state', 'uploading')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })
})

describe('FileDropzone — критерий приёмки 4 (чек-лист качества)', () => {
  it('рендерит все пункты, непройденный отличим от пройденного не только цветом (форма иконки)', () => {
    render(
      <FileDropzone
        t={t}
        accept="image/*"
        maxSizeMb={10}
        onUpload={vi.fn()}
        qualityChecks={[
          { label: 'Хорошее освещение', passed: false },
          { label: 'Текст читаем', passed: true },
        ]}
      />,
    )

    const list = screen.getByTestId('dorutj-file-dropzone-quality-checks')
    expect(list).toHaveTextContent('Хорошее освещение')
    expect(list).toHaveTextContent('Текст читаем')
    expect(screen.getByText(t('ui.file_dropzone.quality_check_failed'))).toBeInTheDocument()
    expect(screen.getByText(t('ui.file_dropzone.quality_check_passed'))).toBeInTheDocument()

    const paths = Array.from(list.querySelectorAll('svg path')).map((path) => path.getAttribute('d'))
    // Иконка ✕ (CloseGlyph) и иконка ✓ (CheckGlyph) — РАЗНЫЕ пути, не одна и та же форма перекрашенная.
    expect(new Set(paths).size).toBe(2)
  })

  it('не рендерит список, если qualityChecks не задан', () => {
    render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={vi.fn()} />)
    expect(screen.queryByTestId('dorutj-file-dropzone-quality-checks')).not.toBeInTheDocument()
  })
})

describe('FileDropzone — превью', () => {
  it('рендерит previewUrl как изображение с alt-текстом', () => {
    render(
      <FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={vi.fn()} previewUrl="blob:mock-preview" />,
    )
    const preview = screen.getByAltText(t('ui.file_dropzone.preview_alt'))
    expect(preview).toHaveAttribute('src', 'blob:mock-preview')
  })
})

describe('FileDropzone — disabled', () => {
  it('игнорирует drop, когда disabled', () => {
    const onUpload = vi.fn()
    render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={onUpload} disabled />)
    const file = createFile('recipe.jpg', 'image/jpeg', 1 * BYTES_PER_MB)
    fireEvent.drop(screen.getByTestId('dorutj-file-dropzone'), { dataTransfer: { files: [file] } })
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('не переключает dragging-визуал, когда disabled', () => {
    render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={vi.fn()} disabled />)
    const dropzone = screen.getByTestId('dorutj-file-dropzone')
    fireEvent.dragOver(dropzone)
    expect(dropzone).toHaveAttribute('data-state', 'idle')
  })
})

describe('FileDropzone — состояние dragging', () => {
  it('dragOver переключает состояние на dragging и текст-подсказку, dragLeave возвращает idle', () => {
    render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={vi.fn()} />)
    const dropzone = screen.getByTestId('dorutj-file-dropzone')

    fireEvent.dragOver(dropzone)
    expect(dropzone).toHaveAttribute('data-state', 'dragging')
    expect(screen.getByText(t('ui.file_dropzone.placeholder_dragging'))).toBeInTheDocument()

    fireEvent.dragLeave(dropzone)
    expect(dropzone).toHaveAttribute('data-state', 'idle')
    expect(screen.getByText(t('ui.file_dropzone.placeholder_idle'))).toBeInTheDocument()
  })

  it('drop сбрасывает dragging обратно в idle/выбранный файл', () => {
    render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={vi.fn()} />)
    const dropzone = screen.getByTestId('dorutj-file-dropzone')
    const file = createFile('recipe.jpg', 'image/jpeg', 1 * BYTES_PER_MB)

    fireEvent.dragOver(dropzone)
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    expect(dropzone).toHaveAttribute('data-state', 'idle')
    expect(screen.getByText(t('ui.file_dropzone.selected_file', { name: 'recipe.jpg' }))).toBeInTheDocument()
  })
})

describe('FileDropzone — кнопка «Выбрать файл»', () => {
  it('клик открывает скрытый input (fallback для touch-устройств без drag)', () => {
    render(<FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={vi.fn()} />)
    const input = screen.getByTestId('dorutj-file-dropzone-input')
    const clickSpy = vi.spyOn(input, 'click')

    fireEvent.click(screen.getByRole('button', { name: t('ui.file_dropzone.select_button') }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})

describe('FileDropzone — доступность', () => {
  it('нулевые critical/serious нарушения в состоянии idle', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <FileDropzone t={t} accept="image/*" maxSizeMb={10} onUpload={vi.fn()} />,
    )
    assertNoBlockingViolations(axeResults)
  })

  it('нулевые critical/serious нарушения с чек-листом и ошибкой', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <FileDropzone
        t={t}
        accept="image/*"
        maxSizeMb={10}
        onUpload={vi.fn()}
        errorKey="ux.error.image_illegible"
        qualityChecks={[{ label: 'Хорошее освещение', passed: false }]}
      />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
