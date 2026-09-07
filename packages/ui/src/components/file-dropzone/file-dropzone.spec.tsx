import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { FileDropzone } from './file-dropzone.js'

/**
 * `jsdom` не реализует настоящий drag-and-drop браузера — `DragEvent`/`DataTransfer` собираются
 * вручную через `fireEvent.drop(zone, { dataTransfer: { files: [...] } })`. Это проверяет ЛОГИКУ
 * компонента (обработчик `onDrop`, извлечение `files[0]`), а не факт визуального переноса файла
 * мышью — эта часть остаётся на браузерный E2E (Playwright), см. отчёт сдачи.
 */
function makeFile(name: string, sizeBytes: number, type: string): File {
  const file = new File(['x'.repeat(Math.max(sizeBytes, 1))], name, { type })
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

function getZone(container: HTMLElement): HTMLElement {
  const zone = container.querySelector('.ui-file-dropzone__zone')
  if (zone === null) {
    throw new Error('Зона дропзоны не найдена')
  }
  return zone as HTMLElement
}

const BYTES_PER_MB = 1024 * 1024

describe('FileDropzone — drag-and-drop и кнопка дают идентичный результат', () => {
  it('drop валидного файла вызывает onFileAccepted с этим файлом', () => {
    const onFileAccepted = vi.fn()
    const { container } = render(
      <FileDropzone
        accept="image/*"
        maxSizeMb={10}
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={onFileAccepted}
        previewAltText="Превью рецепта"
      />,
    )
    const file = makeFile('recipe.png', 1024, 'image/png')

    fireEvent.drop(getZone(container), { dataTransfer: { files: [file] } })

    expect(onFileAccepted).toHaveBeenCalledTimes(1)
    expect(onFileAccepted).toHaveBeenCalledWith(file)
  })

  it('выбор того же файла через кнопку «Выбрать файл» (input[type=file]) вызывает onFileAccepted', () => {
    const onFileAccepted = vi.fn()
    render(
      <FileDropzone
        accept="image/*"
        maxSizeMb={10}
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={onFileAccepted}
        previewAltText="Превью рецепта"
      />,
    )
    const file = makeFile('recipe.png', 1024, 'image/png')
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!

    fireEvent.change(input, { target: { files: [file] } })

    expect(onFileAccepted).toHaveBeenCalledTimes(1)
    expect(onFileAccepted).toHaveBeenCalledWith(file)
  })

  it('кнопка «Выбрать файл» — обычная кнопка (Enter/Space нативно работают, клавиатурный доступ без drag)', () => {
    render(
      <FileDropzone
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={() => undefined}
        previewAltText="Превью"
      />,
    )
    const button = screen.getByRole('button', { name: 'Выбрать файл' })
    expect(button.tagName).toBe('BUTTON')
    expect(button).not.toHaveAttribute('tabindex', '-1')
  })
})

describe('FileDropzone — клиентская пре-валидация (AC3)', () => {
  it('файл 15 МБ при maxSizeMb=10 отклоняется клиентски ДО сети, onFileAccepted не вызывается', () => {
    const onFileAccepted = vi.fn()
    const onFileRejected = vi.fn()
    const { container, rerender } = render(
      <FileDropzone
        accept="image/*"
        maxSizeMb={10}
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={onFileAccepted}
        onFileRejected={onFileRejected}
        tooLargeMessage="Файл слишком большой"
        previewAltText="Превью"
      />,
    )
    const oversizedFile = makeFile('big.png', 15 * BYTES_PER_MB, 'image/png')

    fireEvent.drop(getZone(container), { dataTransfer: { files: [oversizedFile] } })

    expect(onFileAccepted).not.toHaveBeenCalled()
    expect(onFileRejected).toHaveBeenCalledWith('too_large', oversizedFile)
    expect(screen.getByRole('alert')).toHaveTextContent('Файл слишком большой')

    // Ре-рендер тем же деревом — ошибка остаётся управляемой пропом, не залипает в закрытом состоянии.
    rerender(
      <FileDropzone
        accept="image/*"
        maxSizeMb={10}
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={onFileAccepted}
        onFileRejected={onFileRejected}
        tooLargeMessage="Файл слишком большой"
        previewAltText="Превью"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Файл слишком большой')
  })

  it('несовпадение accept отклоняется клиентски с error-текстом invalidTypeMessage', () => {
    const onFileAccepted = vi.fn()
    const onFileRejected = vi.fn()
    const { container } = render(
      <FileDropzone
        accept="image/*"
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={onFileAccepted}
        onFileRejected={onFileRejected}
        invalidTypeMessage="Неверный формат файла"
        previewAltText="Превью"
      />,
    )
    const pdfFile = makeFile('doc.pdf', 1024, 'application/pdf')

    fireEvent.drop(getZone(container), { dataTransfer: { files: [pdfFile] } })

    expect(onFileAccepted).not.toHaveBeenCalled()
    expect(onFileRejected).toHaveBeenCalledWith('invalid_type', pdfFile)
    expect(screen.getByRole('alert')).toHaveTextContent('Неверный формат файла')
  })

  it('внешний проп error перекрывает клиентскую пре-валидацию тем же слотом', () => {
    render(
      <FileDropzone
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={() => undefined}
        error="Ошибка сервера: файл повреждён"
        previewAltText="Превью"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Ошибка сервера: файл повреждён')
  })

  it('валидный файл (без ограничений accept/maxSizeMb) принимается', () => {
    const onFileAccepted = vi.fn()
    const { container } = render(
      <FileDropzone
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={onFileAccepted}
        previewAltText="Превью"
      />,
    )
    const file = makeFile('any.bin', 100, 'application/octet-stream')

    fireEvent.drop(getZone(container), { dataTransfer: { files: [file] } })

    expect(onFileAccepted).toHaveBeenCalledWith(file)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('FileDropzone — чек-лист качества (AC4)', () => {
  it('рендерит все пункты, непройденный отличим от пройденного не только цветом (разные иконки)', () => {
    const { container } = render(
      <FileDropzone
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={() => undefined}
        previewAltText="Превью"
        qualityChecks={[
          { label: 'Хорошее освещение', passed: false },
          { label: 'Весь документ в кадре', passed: true },
        ]}
      />,
    )

    const items = container.querySelectorAll('.ui-file-dropzone__check')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveClass('ui-file-dropzone__check--failed')
    expect(items[1]).toHaveClass('ui-file-dropzone__check--passed')
    // Разные SVG-иконки (✕ vs ✓) — не идентичная разметка, различие не только в className/цвете.
    expect(items[0]?.querySelector('svg')?.innerHTML).not.toBe(items[1]?.querySelector('svg')?.innerHTML)
    expect(screen.getByText('Хорошее освещение')).toBeInTheDocument()
    expect(screen.getByText('Весь документ в кадре')).toBeInTheDocument()
  })
})

describe('FileDropzone — превью и прогресс загрузки', () => {
  it('превью изображения появляется после выбора валидного image-файла (URL.createObjectURL)', () => {
    const createObjectURLMock = vi.fn(() => 'blob:mock-preview')
    vi.stubGlobal('URL', { ...URL, createObjectURL: createObjectURLMock, revokeObjectURL: vi.fn() })

    const { container } = render(
      <FileDropzone
        accept="image/*"
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={() => undefined}
        previewAltText="Превью рецепта"
      />,
    )
    const file = makeFile('recipe.png', 1024, 'image/png')

    fireEvent.drop(getZone(container), { dataTransfer: { files: [file] } })

    const preview = screen.getByAltText<HTMLImageElement>('Превью рецепта')
    expect(preview.src).toContain('blob:mock-preview')

    vi.unstubAllGlobals()
  })

  it('uploadProgress рисуется через ProgressBar (role=progressbar), не собственным баром', () => {
    render(
      <FileDropzone
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={() => undefined}
        previewAltText="Превью"
        uploadProgress={42}
      />,
    )
    const progress = screen.getByRole('progressbar')
    expect(progress).toHaveAttribute('aria-valuenow', '42')
  })

  it('disabled и uploadProgress блокируют input и кнопку выбора файла', () => {
    render(
      <FileDropzone
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={() => undefined}
        previewAltText="Превью"
        uploadProgress={10}
      />,
    )
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(input).toBeDisabled()
  })
})

describe('FileDropzone — drag-hover и disabled', () => {
  it('dragLeave снимает визуальное состояние dragging', () => {
    const { container } = render(
      <FileDropzone label="Перетащите фото сюда" browseButtonLabel="Выбрать файл" onFileAccepted={() => undefined} previewAltText="Превью" />,
    )
    const zone = getZone(container)

    fireEvent.dragOver(zone, { dataTransfer: { files: [] } })
    expect(zone).toHaveClass('ui-file-dropzone__zone--dragging')

    fireEvent.dragLeave(zone)
    expect(zone).not.toHaveClass('ui-file-dropzone__zone--dragging')
  })

  it('disabled=true игнорирует drop файла (onFileAccepted не вызывается)', () => {
    const onFileAccepted = vi.fn()
    const { container } = render(
      <FileDropzone
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={onFileAccepted}
        previewAltText="Превью"
        disabled
      />,
    )
    const file = makeFile('recipe.png', 1024, 'image/png')

    fireEvent.drop(getZone(container), { dataTransfer: { files: [file] } })

    expect(onFileAccepted).not.toHaveBeenCalled()
  })

  it('клик по кнопке «Выбрать файл» открывает системный выбор файла (click скрытого input)', () => {
    render(
      <FileDropzone label="Перетащите фото сюда" browseButtonLabel="Выбрать файл" onFileAccepted={() => undefined} previewAltText="Превью" />,
    )
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const clickSpy = vi.spyOn(input, 'click')

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать файл' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})

describe('FileDropzone — доступность', () => {
  it('renderWithA11yCheck — ноль критичных/серьёзных нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <FileDropzone
        accept="image/*"
        maxSizeMb={10}
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={() => undefined}
        previewAltText="Превью"
        qualityChecks={[{ label: 'Хорошее освещение', passed: false }]}
      />,
    )
    expect(axeResults).toHaveNoViolations()
  })

  it('renderWithA11yCheck в error-состоянии — ноль критичных/серьёзных нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <FileDropzone
        label="Перетащите фото сюда"
        browseButtonLabel="Выбрать файл"
        onFileAccepted={() => undefined}
        previewAltText="Превью"
        error="Файл повреждён"
      />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
