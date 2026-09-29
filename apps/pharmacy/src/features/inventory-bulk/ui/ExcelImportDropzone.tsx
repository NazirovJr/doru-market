import { useState, type ReactElement } from 'react'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { Button, FileDropzone, RadioGroup, Select } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/api/auth-store'
import { canSaveInventory } from '@/shared/auth/inventory-permissions'
import type { InventoryExcelImportMode } from '@dorutj/contracts'
import { downloadInventoryImportTemplate, useExcelImport } from '@/features/inventory-bulk/api/use-excel-import'
import { useChainPharmacies } from '@/features/inventory-bulk/api/use-chain-pharmacies'
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

function resolveCanUpload(input: {
  readonly file: File | null
  readonly mode: InventoryExcelImportMode | null
  readonly isPending: boolean
  readonly requiresPharmacyPicker: boolean
  readonly pharmacyId: string | null
}): boolean {
  if (input.file === null || input.mode === null || input.isPending) return false
  return !input.requiresPharmacyPicker || input.pharmacyId !== null
}

const ChainPharmacyPicker = (props: {
  readonly t: TranslateFunction
  readonly pharmacies: readonly { readonly id: string; readonly name: string }[]
  readonly value: string | null
  readonly disabled: boolean
  readonly showError: boolean
  readonly onChange: (value: string) => void
}): ReactElement => (
  <>
    <Select
      label={props.t('pharmacy.inventory.bulk_edit.pharmacy_label')}
      placeholder={props.t('pharmacy.inventory.bulk_edit.pharmacy_placeholder')}
      options={props.pharmacies.map((pharmacy) => ({ value: pharmacy.id, label: pharmacy.name }))}
      value={props.value}
      disabled={props.disabled}
      onChange={props.onChange}
    />
    {props.showError ? (
      <p role="alert" data-testid="excel-import-pharmacy-error" className="text-xs text-brand-danger">
        {props.t('pharmacy.inventory.bulk_edit.pharmacy_required_error')}
      </p>
    ) : null}
  </>
)

interface DropzoneFormState {
  readonly t: TranslateFunction
  readonly file: File | null
  readonly mode: InventoryExcelImportMode | null
  readonly pharmacyId: string | null
  readonly templateError: boolean
  readonly requiresPharmacyPicker: boolean
  readonly chainPharmacies: readonly { readonly id: string; readonly name: string }[]
  readonly canUpload: boolean
  readonly excelImport: ReturnType<typeof useExcelImport>
  readonly onDownloadTemplate: () => void
  readonly onFileAccepted: (file: File) => void
  readonly onModeChange: (mode: InventoryExcelImportMode) => void
  readonly onPharmacyChange: (pharmacyId: string) => void
  readonly onUpload: () => void
}

const DropzoneForm = (state: DropzoneFormState): ReactElement => (
  <div className="flex flex-col gap-3" data-testid="excel-import-dropzone">
    <div>
      <Button type="button" variant="ghost" onClick={state.onDownloadTemplate} data-testid="excel-import-download-template">
        {state.t('pharmacy.inventory.bulk_edit.download_template')}
      </Button>
      {state.templateError ? (
        <p role="alert" className="text-xs text-brand-danger">
          {state.t('pharmacy.inventory.bulk_edit.download_template_error')}
        </p>
      ) : null}
    </div>

    {state.requiresPharmacyPicker ? (
      <ChainPharmacyPicker
        t={state.t}
        pharmacies={state.chainPharmacies}
        value={state.pharmacyId}
        disabled={state.excelImport.isPending}
        showError={state.file !== null && state.pharmacyId === null}
        onChange={state.onPharmacyChange}
      />
    ) : null}

    <FileDropzone
      t={state.t}
      accept={ACCEPTED_EXTENSIONS}
      maxSizeMb={EXCEL_IMPORT_MAX_SIZE_MB}
      disabled={state.excelImport.isPending}
      onUpload={state.onFileAccepted}
    />

    <RadioGroup
      name="excel-import-mode"
      label={state.t('pharmacy.inventory.bulk_edit.mode_label')}
      options={MODE_OPTIONS.map((option) => ({ value: option.value, label: state.t(option.labelKey) }))}
      value={state.mode}
      disabled={state.excelImport.isPending}
      onChange={(value) => { state.onModeChange(value as InventoryExcelImportMode) }}
    />
    {state.file !== null && state.mode === null ? (
      <p role="alert" data-testid="excel-import-mode-error" className="text-xs text-brand-danger">
        {state.t('pharmacy.inventory.bulk_edit.mode_required_error')}
      </p>
    ) : null}

    <Button type="button" disabled={!state.canUpload} loading={state.excelImport.isPending} onClick={state.onUpload} data-testid="excel-import-upload-button">
      {state.t('pharmacy.inventory.bulk_edit.upload_button')}
    </Button>

    {state.excelImport.isError ? (
      <p role="alert" data-testid="excel-import-upload-error" className="text-sm text-brand-danger">
        {state.t('pharmacy.inventory.bulk_edit.upload_error')}
      </p>
    ) : null}

    {state.excelImport.isSuccess ? (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink-muted" data-testid="excel-import-accepted-summary">
          {state.t('pharmacy.inventory.bulk_edit.upload_accepted', {
            totalRows: state.excelImport.data.totalRows,
            totalBatches: state.excelImport.data.totalBatches,
          })}
        </p>
        <ImportProgressBar sourceUploadId={state.excelImport.data.sourceUploadId} />
      </div>
    ) : null}
  </div>
)

export const ExcelImportDropzone = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<InventoryExcelImportMode | null>(null)
  const [pharmacyId, setPharmacyId] = useState<string | null>(null)
  const [templateError, setTemplateError] = useState(false)
  const excelImport = useExcelImport()
  const role = useAuthStore((state) => state.user?.role)
  const hasEditPermission = canSaveInventory(role)
  // Список пуст (не сетевой admin) — пикер не рендерится, загрузка идёт по claims.pharmacyId как раньше.
  const chainPharmacies = useChainPharmacies(role === 'pharmacy_admin')
  const requiresPharmacyPicker = (chainPharmacies.data?.length ?? 0) > 0
  const canUpload = resolveCanUpload({ file, mode, isPending: excelImport.isPending, requiresPharmacyPicker, pharmacyId })

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
    if (requiresPharmacyPicker && pharmacyId === null) return
    excelImport.mutate(pharmacyId === null ? { file, mode } : { file, mode, pharmacyId })
  }

  return (
    <DropzoneForm
      t={t}
      file={file}
      mode={mode}
      pharmacyId={pharmacyId}
      templateError={templateError}
      requiresPharmacyPicker={requiresPharmacyPicker}
      chainPharmacies={chainPharmacies.data ?? []}
      canUpload={canUpload}
      excelImport={excelImport}
      onDownloadTemplate={handleDownloadTemplate}
      onFileAccepted={handleFileAccepted}
      onModeChange={setMode}
      onPharmacyChange={setPharmacyId}
      onUpload={handleUpload}
    />
  )
}
