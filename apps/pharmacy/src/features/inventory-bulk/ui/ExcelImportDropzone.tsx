import { useRef, useState, type ChangeEvent, type DragEvent, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import type { InventoryExcelImportMode } from '@dorutj/contracts'
import { downloadInventoryImportTemplate, useExcelImport } from '@/features/inventory-bulk/api/use-excel-import'
import { ImportProgressBar } from './ImportProgressBar'

const ACCEPTED_EXTENSIONS = '.xlsx,.csv'

interface ModeOption {
  readonly value: InventoryExcelImportMode
  readonly labelKey: string
}

const MODE_OPTIONS: readonly ModeOption[] = [
  { value: 'append_update', labelKey: 'pharmacy.inventory.bulk_edit.mode_append_update' },
  { value: 'full_replace', labelKey: 'pharmacy.inventory.bulk_edit.mode_full_replace' },
]

/** TODO(DTJ-410): заменить на FileDropzone из packages/ui, когда он появится. */
export const ExcelImportDropzone = (): ReactElement => {
  const { t } = useT('tj')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<InventoryExcelImportMode | null>(null)
  const [templateError, setTemplateError] = useState(false)
  const excelImport = useExcelImport()

  const canUpload = file !== null && mode !== null && !excelImport.isPending

  function handleFile(nextFile: File | null): void {
    setFile(nextFile)
    excelImport.reset()
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    handleFile(event.dataTransfer.files[0] ?? null)
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    handleFile(event.target.files?.[0] ?? null)
  }

  function handleDownloadTemplate(): void {
    setTemplateError(false)
    downloadInventoryImportTemplate().catch(() => { setTemplateError(true) })
  }

  function handleUpload(): void {
    if (file === null || mode === null) return
    excelImport.mutate({ file, mode })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="excel-import-dropzone">
      <div>
        <button
          type="button"
          onClick={handleDownloadTemplate}
          data-testid="excel-import-download-template"
          className="text-sm text-brand-primary underline"
        >
          {t('pharmacy.inventory.bulk_edit.download_template')}
        </button>
        {templateError ? (
          <p role="alert" className="text-xs text-brand-danger">
            {t('pharmacy.inventory.bulk_edit.download_template_error')}
          </p>
        ) : null}
      </div>

      <div
        onDragOver={(event) => { event.preventDefault() }}
        onDrop={handleDrop}
        onClick={() => { fileInputRef.current?.click() }}
        data-testid="excel-import-drop-area"
        className="cursor-pointer rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted"
      >
        {file === null
          ? t('pharmacy.inventory.bulk_edit.dropzone_placeholder')
          : t('pharmacy.inventory.bulk_edit.dropzone_selected_file', { name: file.name })}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          data-testid="excel-import-file-input"
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm text-ink">{t('pharmacy.inventory.bulk_edit.mode_label')}</legend>
        {MODE_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="excel-import-mode"
              value={option.value}
              checked={mode === option.value}
              data-testid={`excel-import-mode-${option.value}`}
              onChange={() => { setMode(option.value) }}
            />
            {t(option.labelKey)}
          </label>
        ))}
        {file !== null && mode === null ? (
          <p role="alert" data-testid="excel-import-mode-error" className="text-xs text-brand-danger">
            {t('pharmacy.inventory.bulk_edit.mode_required_error')}
          </p>
        ) : null}
      </fieldset>

      <button
        type="button"
        disabled={!canUpload}
        onClick={handleUpload}
        data-testid="excel-import-upload-button"
        className="inline-flex items-center justify-center rounded-md bg-brand-primary px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {excelImport.isPending ? t('pharmacy.inventory.bulk_edit.upload_pending') : t('pharmacy.inventory.bulk_edit.upload_button')}
      </button>

      {excelImport.isError ? (
        <p role="alert" data-testid="excel-import-upload-error" className="text-sm text-brand-danger">
          {t('pharmacy.inventory.bulk_edit.upload_error')}
        </p>
      ) : null}

      {excelImport.isSuccess ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted" data-testid="excel-import-accepted-summary">
            {t('pharmacy.inventory.bulk_edit.upload_accepted', {
              totalRows: excelImport.data.totalRows,
              totalBatches: excelImport.data.totalBatches,
            })}
          </p>
          <ImportProgressBar sourceUploadId={excelImport.data.sourceUploadId} />
        </div>
      ) : null}
    </div>
  )
}
