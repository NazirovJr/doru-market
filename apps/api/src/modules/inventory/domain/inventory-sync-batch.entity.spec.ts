/**
 * Тест `InventorySyncBatch` aggregate (EP-05, DTJ-144, SRS-DOM-145..150).
 *
 * Покрывает: создание в `queued`, разрешённые переходы, ЗАПРЕТ переходов
 * из терминальных статусов, ЗАПРЕТ `queued → completed_*` напрямую,
 * инвариант `acceptedRows + rejectedRows = totalRows` для
 * `partial_success`, инвариант `isFullSyncLastPage`.
 */
import { describe, expect, it } from 'vitest'
import { InventorySyncBatch, type BatchStatus } from './inventory-sync-batch.entity.js'
import { IllegalBatchStatusTransitionError } from './errors/inventory.errors.js'

const BATCH_ID = '44444444-4444-4444-4444-444444444444'
const PHARMACY_ID = '22222222-2222-2222-2222-222222222222'
// eslint-disable-next-line no-restricted-globals -- `now: Date` — параметр доменного метода по контракту (`02` §2.6).
const RECEIVED_AT = new Date('2026-01-15T10:00:00.000Z')
// eslint-disable-next-line no-restricted-globals -- `now: Date` — параметр доменного метода по контракту (`02` §2.6).
const COMPLETED_AT = new Date('2026-01-15T10:05:00.000Z')

function newQueuedBatch(): InventorySyncBatch {
  return InventorySyncBatch.create(
    {
      id: BATCH_ID,
      pharmacyId: PHARMACY_ID,
      channel: 'manual',
      syncType: 'delta',
      totalRows: 1000,
    },
    RECEIVED_AT,
  )
}

describe('InventorySyncBatch (DTJ-144, SRS-DOM-145..150)', () => {
  describe('create', () => {
    it('инициализирует статус queued', () => {
      const batch = newQueuedBatch()
      expect(batch.status).toBe('queued')
      expect(batch.acceptedRows).toBe(0)
      expect(batch.rejectedRows).toBe(0)
      expect(batch.completedAt).toBeNull()
      expect(batch.isTerminal).toBe(false)
    })

    it('бросает, если totalRows отрицательный', () => {
      expect(() =>
        InventorySyncBatch.create(
          {
            id: BATCH_ID,
            pharmacyId: PHARMACY_ID,
            channel: 'manual',
            syncType: 'delta',
            totalRows: -1,
          },
          RECEIVED_AT,
        ),
      ).toThrow()
    })

    it('бросает, если syncType=full без fullSyncSessionId', () => {
      expect(() =>
        InventorySyncBatch.create(
          {
            id: BATCH_ID,
            pharmacyId: PHARMACY_ID,
            channel: 'rest',
            syncType: 'full',
            totalRows: 1000,
          },
          RECEIVED_AT,
        ),
      ).toThrow(/fullSyncSessionId is required/)
    })

    it('бросает, если syncType=delta с fullSyncSessionId', () => {
      expect(() =>
        InventorySyncBatch.create(
          {
            id: BATCH_ID,
            pharmacyId: PHARMACY_ID,
            channel: 'manual',
            syncType: 'delta',
            totalRows: 1000,
            fullSyncSessionId: 'session-1',
          },
          RECEIVED_AT,
        ),
      ).toThrow(/fullSyncSessionId must be undefined/)
    })
  })

  describe('markProcessing', () => {
    it('переводит из queued в processing', () => {
      const batch = newQueuedBatch()
      batch.markProcessing()
      expect(batch.status).toBe('processing')
      expect(batch.isTerminal).toBe(false)
    })
  })

  describe('markCompletedFullSuccess', () => {
    it('переводит из processing в completed_full_success', () => {
      const batch = newQueuedBatch()
      batch.markProcessing()
      batch.markCompletedFullSuccess()
      expect(batch.status).toBe('completed_full_success')
      expect(batch.isTerminal).toBe(true)
    })
  })

  describe('markCompletedPartialSuccess', () => {
    it('переводит из processing в completed_partial_success с правильными счётчиками', () => {
      const batch = newQueuedBatch()
      batch.markProcessing()
      batch.markCompletedPartialSuccess(988, 12, COMPLETED_AT)
      expect(batch.status).toBe('completed_partial_success')
      expect(batch.acceptedRows).toBe(988)
      expect(batch.rejectedRows).toBe(12)
      expect(batch.completedAt).toEqual(COMPLETED_AT)
      expect(batch.isTerminal).toBe(true)
    })

    it('бросает, если счётчики не сходятся к totalRows', () => {
      const batch = newQueuedBatch()
      batch.markProcessing()
      expect(() => { batch.markCompletedPartialSuccess(100, 12, COMPLETED_AT); }).toThrow(
        /partial success counters inconsistent/,
      )
    })
  })

  describe('markFailedValidation', () => {
    it('переводит из processing в failed_validation с errorSummary', () => {
      const batch = newQueuedBatch()
      batch.markProcessing()
      batch.markFailedValidation(
        [{ rowIndex: 3, reason: 'barcode invalid' }],
        COMPLETED_AT,
      )
      expect(batch.status).toBe('failed_validation')
      expect(batch.rejectedRows).toBe(1)
      expect(batch.errorSummary).not.toBeNull()
      expect(batch.isTerminal).toBe(true)
    })

    it('бросает, если передан пустой errors', () => {
      const batch = newQueuedBatch()
      batch.markProcessing()
      expect(() => { batch.markFailedValidation([], COMPLETED_AT); }).toThrow(
        /non-empty errors/,
      )
    })
  })

  describe('запрет недопустимых переходов (SRS-DOM-150)', () => {
    const TERMINAL: readonly BatchStatus[] = [
      'completed_full_success',
      'completed_partial_success',
      'failed_validation',
    ]

    it.each(TERMINAL)('любой переход из терминального %s бросает', (terminal) => {
      const batch = InventorySyncBatch.restore({
        id: BATCH_ID,
        pharmacyId: PHARMACY_ID,
        channel: 'manual',
        syncType: 'delta',
        status: terminal,
        totalRows: 1000,
        acceptedRows: 1000,
        rejectedRows: 0,
        fullSyncSessionId: null,
        pageNumber: 1,
        isLastPage: true,
        receivedAt: RECEIVED_AT,
        completedAt: COMPLETED_AT,
        errorSummary: null,
        note: null,
      })
      expect(() => { batch.markProcessing(); }).toThrow(IllegalBatchStatusTransitionError)
      expect(() => { batch.markCompletedFullSuccess(); }).toThrow(IllegalBatchStatusTransitionError)
      expect(() => { batch.markCompletedPartialSuccess(1000, 0, COMPLETED_AT); },
      ).toThrow(IllegalBatchStatusTransitionError)
      expect(() => { batch.markFailedValidation([{ rowIndex: 0, reason: 'x' }], COMPLETED_AT); },
      ).toThrow(IllegalBatchStatusTransitionError)
    })

    it('queued → completed_full_success напрямую запрещён', () => {
      const batch = newQueuedBatch()
      expect(() => { batch.markCompletedFullSuccess(); }).toThrow(
        IllegalBatchStatusTransitionError,
      )
    })

    it('queued → completed_partial_success напрямую запрещён', () => {
      const batch = newQueuedBatch()
      expect(() => { batch.markCompletedPartialSuccess(1000, 0, COMPLETED_AT); }).toThrow(
        IllegalBatchStatusTransitionError,
      )
    })

    it('queued → failed_validation напрямую запрещён', () => {
      const batch = newQueuedBatch()
      expect(() => { batch.markFailedValidation([{ rowIndex: 0, reason: 'x' }], COMPLETED_AT); },
      ).toThrow(IllegalBatchStatusTransitionError)
    })
  })

  describe('isFullSyncLastPage', () => {
    it('истинен только для syncType=full И isLastPage=true', () => {
      const batch = InventorySyncBatch.create(
        {
          id: BATCH_ID,
          pharmacyId: PHARMACY_ID,
          channel: 'rest',
          syncType: 'full',
          totalRows: 500,
          fullSyncSessionId: 'session-1',
          isLastPage: true,
        },
        RECEIVED_AT,
      )
      expect(batch.isFullSyncLastPage).toBe(true)
    })

    it('ложен для delta даже при isLastPage=true', () => {
      const batch = InventorySyncBatch.create(
        {
          id: BATCH_ID,
          pharmacyId: PHARMACY_ID,
          channel: 'manual',
          syncType: 'delta',
          totalRows: 500,
          isLastPage: true,
        },
        RECEIVED_AT,
      )
      expect(batch.isFullSyncLastPage).toBe(false)
    })

    it('ложен для full при isLastPage=false', () => {
      const batch = InventorySyncBatch.create(
        {
          id: BATCH_ID,
          pharmacyId: PHARMACY_ID,
          channel: 'rest',
          syncType: 'full',
          totalRows: 500,
          fullSyncSessionId: 'session-1',
          isLastPage: false,
        },
        RECEIVED_AT,
      )
      expect(batch.isFullSyncLastPage).toBe(false)
    })
  })

  describe('toSnapshot', () => {
    it('отдаёт полный снимок состояния', () => {
      const batch = newQueuedBatch()
      batch.markProcessing()
      const snapshot = batch.toSnapshot()
      expect(snapshot.id).toBe(BATCH_ID)
      expect(snapshot.status).toBe('processing')
      expect(snapshot.receivedAt).toEqual(RECEIVED_AT)
    })
  })
})
