import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, FileDropzone, RadioGroup } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/api/auth-store'
import { canSaveInventory } from '@/shared/auth/inventory-permissions'
import type { InventoryExcelImportMode } from '@dorutj/contracts'
import { downloadInventoryImportTemplate, useExcelImport } from '@/features/inventory-bulk/api/use-excel-import'
import { ImportProgressBar } from './ImportProgressBar'

const ACCEPTED_EXTENSIONS = '.xlsx,.csv'
/** ASSUMPTION: спека не задаёт лимит размера Excel-импорта — тот же порядок, что серверный лимит загрузки. */
const EXCEL_IMPORT_MAX_SIZE_MB = 20

interface ModeOption {
  readonly value: InventoryExcelImportMode
  readonly labelKey: string
}

const MODE_OPTIONS: readonly ModeOption[] = [
  { value: 'append_update', labelKey: 'pharmacy.inventory.bulk_edit.mode_append_update' },
  { value: 'full_replace', labelKey: 'pharmacy.inventory.bulk_edit.mode_full_replace' },
]

export const ExcelImportDropzone = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<InventoryExcelImportMode | null>(null)
  const [templateError, setTemplateError] = useState(false)
  const excelImport = useExcelImport()
  const hasEditPermission = canSaveInventory(useAuthStore((state) => state.user?.role))

  const canUpload = file !== null && mode !== null && !excelImport.isPending

  if (!hasEditPermission) {
    return (
      <p role="status" data-testid="excel-import-readonly-hint" className="text-sm text-ink-muted">
        {t('pharmacy.inventory.point_edit.error_insufficient_role')}
      </p>
    )
  }

  function handleFileAccepted(nextFile: File): void {
    setFile(nextFile)
    excelImport.reset()
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
        <Button type="button" variant="ghost" onClick={handleDownloadTemplate} data-testid="excel-import-download-template">
          {t('pharmacy.inventory.bulk_edit.download_template')}
        </Button>
        {templateError ? (
          <p role="alert" className="text-xs text-brand-danger">
            {t('pharmacy.inventory.bulk_edit.download_template_error')}
          </p>
        ) : null}
      </div>

      <FileDropzone
        t={t}
        accept={ACCEPTED_EXTENSIONS}
        maxSizeMb={EXCEL_IMPORT_MAX_SIZE_MB}
        disabled={excelImport.isPending}
        onUpload={handleFileAccepted}
      />

      <RadioGroup
        name="excel-import-mode"
        label={t('pharmacy.inventory.bulk_edit.mode_label')}
        options={MODE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
        value={mode}
        disabled={excelImport.isPending}
        onChange={(value) => { setMode(value as InventoryExcelImportMode) }}
      />
      {file !== null && mode === null ? (
        <p role="alert" data-testid="excel-import-mode-error" className="text-xs text-brand-danger">
          {t('pharmacy.inventory.bulk_edit.mode_required_error')}
        </p>
      ) : null}

      <Button type="button" disabled={!canUpload} loading={excelImport.isPending} onClick={handleUpload} data-testid="excel-import-upload-button">
        {t('pharmacy.inventory.bulk_edit.upload_button')}
      </Button>

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
