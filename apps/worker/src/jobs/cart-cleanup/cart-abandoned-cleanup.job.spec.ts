import { Logger } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { CartAbandonedCleanupJob } from './cart-abandoned-cleanup.job.js'
import type { CartCleanupRetentionPort } from './cart-cleanup-retention.port.js'

const FIXED_NOW = new Date('2026-09-02T10:00:00.000Z')
const REGISTERED_TTL_DAYS = 30
const GUEST_TTL_DAYS = 7

describe('CartAbandonedCleanupJob', () => {
  let deleteRegisteredMock: Mock<CartCleanupRetentionPort['deleteAbandonedRegisteredCarts']>
  let deleteGuestMock: Mock<CartCleanupRetentionPort['deleteAbandonedGuestCarts']>
  let job: CartAbandonedCleanupJob

  beforeEach(() => {
    deleteRegisteredMock = vi.fn()
    deleteGuestMock = vi.fn()
    const retention: CartCleanupRetentionPort = {
      deleteAbandonedRegisteredCarts: deleteRegisteredMock,
      deleteAbandonedGuestCarts: deleteGuestMock,
    }
    job = new CartAbandonedCleanupJob(retention, REGISTERED_TTL_DAYS, GUEST_TTL_DAYS)
  })

  it('AC5 DTJ-224: вычисляет cutoff зарегистрированных корзин детерминированно от переданного `now` (30 дней)', async () => {
    deleteRegisteredMock.mockResolvedValue(0)
    deleteGuestMock.mockResolvedValue(0)

    await job.runOnce(FIXED_NOW)

    const [cutoff] = deleteRegisteredMock.mock.calls[0] as [Date]
    expect(cutoff.toISOString()).toBe('2026-08-03T10:00:00.000Z') // FIXED_NOW - 30 дней
  })

  it('гостевые корзины используют СВОЙ, более короткий cutoff (7 дней) — не путается с 30-дневным', async () => {
    deleteRegisteredMock.mockResolvedValue(0)
    deleteGuestMock.mockResolvedValue(0)

    await job.runOnce(FIXED_NOW)

    const [cutoff] = deleteGuestMock.mock.calls[0] as [Date]
    expect(cutoff.toISOString()).toBe('2026-08-26T10:00:00.000Z') // FIXED_NOW - 7 дней
  })

  it('возвращает число удалённых строк каждой категории от порта', async () => {
    deleteRegisteredMock.mockResolvedValue(5)
    deleteGuestMock.mockResolvedValue(2)

    const result = await job.runOnce(FIXED_NOW)

    expect(result).toEqual({ registeredDeleted: 5, guestDeleted: 2 })
  })

  it('вызывает оба DELETE ПАРАЛЛЕЛЬНО (Promise.all, C14) — оба порта дёрнуты за один runOnce', async () => {
    deleteRegisteredMock.mockResolvedValue(0)
    deleteGuestMock.mockResolvedValue(0)

    await job.runOnce(FIXED_NOW)

    expect(deleteRegisteredMock).toHaveBeenCalledTimes(1)
    expect(deleteGuestMock).toHaveBeenCalledTimes(1)
  })

  it('D-EP09-15: TTL=0 (< 1 дня) — ОТКАЗ выполнять, DELETE не вызывается, возвращает нули', async () => {
    const brokenJob = new CartAbandonedCleanupJob(
      { deleteAbandonedRegisteredCarts: deleteRegisteredMock, deleteAbandonedGuestCarts: deleteGuestMock },
      0,
      GUEST_TTL_DAYS,
    )

    const result = await brokenJob.runOnce(FIXED_NOW)

    expect(result).toEqual({ registeredDeleted: 0, guestDeleted: 0 })
    expect(deleteRegisteredMock).not.toHaveBeenCalled()
    expect(deleteGuestMock).not.toHaveBeenCalled()
  })

  it('D-EP09-15: отрицательный guestTtlDays — ОТКАЗ выполнять целиком (обе категории), не только гостевую', async () => {
    const brokenJob = new CartAbandonedCleanupJob(
      { deleteAbandonedRegisteredCarts: deleteRegisteredMock, deleteAbandonedGuestCarts: deleteGuestMock },
      REGISTERED_TTL_DAYS,
      -1,
    )

    const result = await brokenJob.runOnce(FIXED_NOW)

    expect(result).toEqual({ registeredDeleted: 0, guestDeleted: 0 })
    expect(deleteRegisteredMock).not.toHaveBeenCalled()
  })

  it('D-EP09-15: нецелый TTL (защита от неверной инъекции) — ОТКАЗ выполнять', async () => {
    const brokenJob = new CartAbandonedCleanupJob(
      { deleteAbandonedRegisteredCarts: deleteRegisteredMock, deleteAbandonedGuestCarts: deleteGuestMock },
      1.5,
      GUEST_TTL_DAYS,
    )

    const result = await brokenJob.runOnce(FIXED_NOW)

    expect(result).toEqual({ registeredDeleted: 0, guestDeleted: 0 })
    expect(deleteRegisteredMock).not.toHaveBeenCalled()
  })

  it('логирует ERROR при отказе (не тихий no-op)', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const brokenJob = new CartAbandonedCleanupJob(
      { deleteAbandonedRegisteredCarts: deleteRegisteredMock, deleteAbandonedGuestCarts: deleteGuestMock },
      0,
      GUEST_TTL_DAYS,
    )

    await brokenJob.runOnce(FIXED_NOW)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})
