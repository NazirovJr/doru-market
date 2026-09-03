/**
 * Ядро джобы `cart-cleanup` (DTJ-224, SRS-ORD-005..009, «Что сделать» §6): hard-delete
 * брошенных корзин. Регистрированный покупатель — `CART_ABANDONED_TTL_DAYS` (ASSUMPTION 30),
 * гостевая корзина (`customer_id IS NULL`) — короче, `CART_ABANDONED_GUEST_TTL_DAYS`
 * (ASSUMPTION 7): `session_token` сам по себе недолговечен, гостевая корзина мертва раньше.
 * `cart_items` каскадом (`ON DELETE CASCADE`, `0023_orders_cart.sql`) — эта джоба трогает
 * ТОЛЬКО `cart`.
 *
 * `now` — параметр с дефолтом `new Date()` (зеркало `PruneSearchQueryLogProcessor.runOnce`,
 * тот же пакет apps/worker) — тест-план тикета проверяет детерминированный расчёт `cutoff`,
 * передавая фиксированную дату вместо реального времени.
 *
 * D-EP09-15 (`reports/EP09-CTO-BRIEF.md`, БЛОКЕР защиты боевых данных, закрыт CTO ДО старта
 * работ): guard `retentionDays < MIN_CART_ABANDONED_TTL_DAYS` — defense-in-depth ПОВЕРХ
 * валидации `env.schema.ts` (`z.coerce.number().int().min(1)`, отказывает процессу СТАРТОВАТЬ).
 * Здесь — на случай прямого создания класса в обход `ConfigModule` (тесты, будущий рефакторинг
 * DI) — злоупотребление `ENV=0` не должно быть способно стереть ВСЕ корзины разом голым
 * `DELETE` по неверно сконфигурированному интервалу. Нарушение guard'а логируется `ERROR`,
 * `DELETE` НЕ выполняется, джоба возвращает нули вместо падения процесса (планировщик
 * переживает один плохой тик, не крашится).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts). Относительный путь до правки nest-cli.json.
import { MIN_CART_ABANDONED_TTL_DAYS } from '../../config/env.schema.js'
import {
  CART_ABANDONED_GUEST_TTL_DAYS,
  CART_ABANDONED_TTL_DAYS,
} from './cart-cleanup.constants.js'
import { CART_CLEANUP_RETENTION_PORT, type CartCleanupRetentionPort } from './cart-cleanup-retention.port.js'

const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND
const ZERO_DELETED = 0

export interface CartCleanupResult {
  readonly registeredDeleted: number
  readonly guestDeleted: number
}

@Injectable()
export class CartAbandonedCleanupJob {
  private readonly logger = new Logger(CartAbandonedCleanupJob.name)

  constructor(
    @Inject(CART_CLEANUP_RETENTION_PORT) private readonly retention: CartCleanupRetentionPort,
    // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(CART_ABANDONED_TTL_DAYS) private readonly registeredTtlDays: number,
    @Inject(CART_ABANDONED_GUEST_TTL_DAYS) private readonly guestTtlDays: number,
  ) {}

  /** Один тик: удаляет брошенные корзины ОБЕИХ категорий, возвращает число удалённых строк каждой. */
  async runOnce(now: Date = new Date()): Promise<CartCleanupResult> {
    if (!this.isValidTtl(this.registeredTtlDays) || !this.isValidTtl(this.guestTtlDays)) {
      this.logger.error(
        `cart-cleanup: ОТКАЗ выполнять — CART_ABANDONED_TTL_DAYS=${String(this.registeredTtlDays)}/` +
          `CART_ABANDONED_GUEST_TTL_DAYS=${String(this.guestTtlDays)} — обязаны быть целыми >= ${String(MIN_CART_ABANDONED_TTL_DAYS)} (D-EP09-15)`,
      )
      return { registeredDeleted: ZERO_DELETED, guestDeleted: ZERO_DELETED }
    }

    const registeredCutoff = this.cutoffFor(now, this.registeredTtlDays)
    const guestCutoff = this.cutoffFor(now, this.guestTtlDays)
    // Независимые DELETE на разные подмножества строк (`customer_id IS NOT NULL`/`IS NULL`) —
    // C14, `Promise.all`, не последовательно.
    const [registeredDeleted, guestDeleted] = await Promise.all([
      this.retention.deleteAbandonedRegisteredCarts(registeredCutoff),
      this.retention.deleteAbandonedGuestCarts(guestCutoff),
    ])
    this.logger.log(
      `cart-cleanup: тик выполнен — удалено ${String(registeredDeleted)} зарегистрированных ` +
        `(cutoff ${registeredCutoff.toISOString()}) и ${String(guestDeleted)} гостевых ` +
        `(cutoff ${guestCutoff.toISOString()}) корзин`,
    )
    return { registeredDeleted, guestDeleted }
  }

  private isValidTtl(ttlDays: number): boolean {
    return Number.isInteger(ttlDays) && ttlDays >= MIN_CART_ABANDONED_TTL_DAYS
  }

  private cutoffFor(now: Date, ttlDays: number): Date {
    return new Date(now.getTime() - ttlDays * MS_PER_DAY)
  }
}
