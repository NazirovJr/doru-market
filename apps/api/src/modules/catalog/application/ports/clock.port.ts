/**
 * Порт `Clock` для каталога (DTJ-184, EP-06, R1) — текущее время СУТОК в часовом поясе
 * тенанта. Нужен `PharmacyOpeningHoursPolicy` для фильтров «открыто сейчас»/«24/7»
 * (`SRS-CAT-046`/`SRS-CAT-047`, `docs/spec/20-module-catalog-search.md` §7.3).
 *
 * **Проверка дубликата (Ж12 AGENTS.md — «прежде чем создать, найди»).** Системный порт
 * `Clock` УЖЕ существует: `apps/api/src/shared-kernel/application/ports/clock.port.ts`
 * (EP-01, DTJ-006) — `interface Clock { now(): Date }`, отдаёт сырой момент UTC, уже
 * имеет продакшен-адаптер `SystemClockAdapter`. Спецификация (`20-module-catalog-search.md`
 * §7.3) прямо просит: «если базовый порт уже есть — ТОЛЬКО добавь метод `nowInTenantTz`,
 * не создавай новый порт с нуля».
 *
 * Это НЕ выполнено буквально: `files_owned` тикета DTJ-184 (`AGENTS.md` Ж7 — «не трогай
 * файлы вне своего files_owned») НЕ включает `shared-kernel/application/ports/clock.port.ts`,
 * а исключение «правка одной строкой» (`05-DEVELOPER-HANDBOOK.md` §21) действует только
 * для файла, который тикет И ТАК меняет — этот файл в его набор не входит. Редактировать
 * чужой `files_owned` без согласования — риск конфликта с параллельной работой.
 *
 * Поэтому здесь объявлен catalog-owned порт `Clock` (тот же интерфейс из спеки дословно) —
 * НЕ конкурент системному: разная ответственность (тот — сырой UTC `Date`, этот — уже
 * посчитанное время суток `TimeOfDay` в `Asia/Dushanbe`), производный уровень абстракции
 * над тем же системным временем. DI-токен намеренно назван иначе (`TENANT_CLOCK`, а не
 * `CLOCK`) — чтобы `grep`/автокомплит по токену сразу отличал два порта друг от друга.
 *
 * Продакшен-адаптер этого порта — вне `files_owned` DTJ-184 (нет файла infrastructure-адаптера
 * в списке), появится вместе с первым потребителем (DTJ-188 `SearchMedicinesUseCase` или
 * DTJ-196 `GetPharmacyMapPinsUseCase`, оба заблокированы этим тикетом). Он ОБЯЗАН получать
 * системный `Clock.now()` через DI (не второй `Date.now()`/`new Date()`) и переводить его в
 * `TimeOfDay` через `Intl.DateTimeFormat` с явным `timeZone: 'Asia/Dushanbe'` — не полагаясь
 * на TZ хост-машины (риск тикета: иначе тесты недетерминированы вне Душанбе).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-046, SRS-CAT-047)
 * @see tickets/ep05-search-map/DTJ-184.md
 */
import type { TenantId } from '@/modules/tenancy/index.js'
import { ValidationError } from '@dorutj/contracts'

const MINUTES_PER_HOUR = 60
const MAX_HOUR = 23
const MAX_MINUTE = 59
const TIME_OF_DAY_PATTERN = /^([0-9]{2}):([0-9]{2})$/

/**
 * `TimeOfDay` — время суток (часы:минуты, БЕЗ даты). Неизменяемый VO.
 *
 * `valueOf()` отдаёт минуты с полуночи — TypeScript резолвит операторы `>=`/`<=` на
 * экземплярах через `valueOf()`, поэтому `isOpenNow` (`pharmacy-opening-hours.policy.ts`)
 * реализован ДОСЛОВНО по алгоритму `SRS-CAT-046`, без вспомогательных методов сравнения.
 */
export class TimeOfDay {
  private constructor(private readonly minutesSinceMidnight: number) {}

  /** Валидирует диапазоны `hours ∈ [0,23]`, `minutes ∈ [0,59]`. */
  static of(hours: number, minutes: number): TimeOfDay {
    if (!Number.isInteger(hours) || hours < 0 || hours > MAX_HOUR) {
      throw new ValidationError('Invalid time of day: hours out of range', { field: 'hours', value: hours })
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTE) {
      throw new ValidationError('Invalid time of day: minutes out of range', { field: 'minutes', value: minutes })
    }
    return new TimeOfDay(hours * MINUTES_PER_HOUR + minutes)
  }

  /** Парсит `'HH:MM'` — формат, в котором тест-план и БД (`pharmacies.opening_time`) хранят время. */
  static parse(raw: string): TimeOfDay {
    const match = TIME_OF_DAY_PATTERN.exec(raw)
    if (!match) {
      throw new ValidationError('Invalid time of day format: expected HH:MM', { field: 'raw', value: raw })
    }
    return TimeOfDay.of(Number(match[1]), Number(match[2]))
  }

  /** Минуты с полуночи — основа сравнения операторами `>=`/`<=` через неявный `valueOf()`. */
  valueOf(): number {
    return this.minutesSinceMidnight
  }

  toString(): string {
    const hours = Math.floor(this.minutesSinceMidnight / MINUTES_PER_HOUR)
    const minutes = this.minutesSinceMidnight % MINUTES_PER_HOUR
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }
}

/** DI-токен NestJS для порта `Clock` каталога. Намеренно НЕ `CLOCK` — см. JSDoc файла. */
export const TENANT_CLOCK = Symbol('TENANT_CLOCK')

/**
 * Контракт порта (DTJ-184, дословно по `SRS-CAT-046`). Единственный метод — текущее
 * время суток тенанта в его локальном часовом поясе (`Asia/Dushanbe` для R1 — единственный
 * часовой пояс баланса, без перехода на летнее время, `01-TECH-BASELINE.md`).
 */
export interface Clock {
  nowInTenantTz(tenantId: TenantId): TimeOfDay
}
