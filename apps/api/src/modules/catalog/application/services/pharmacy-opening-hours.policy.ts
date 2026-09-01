/**
 * `PharmacyOpeningHoursPolicy` (DTJ-184, EP-06, R1) — фильтры «открыто сейчас»/«24/7»
 * (`SRS-CAT-046`, `SRS-CAT-047`, `docs/spec/20-module-catalog-search.md` §7.3).
 *
 * Слой `application` (НЕ `domain`, спецификация прямо это указывает — `02` §2, п.6: домен
 * чист от `Date.now()`). Текущее время суток тенанта приходит ТОЛЬКО через порт `Clock`
 * (`clock.port.ts`, этот же тикет), никогда не через `Date.now()`/`new Date()` напрямую —
 * иначе «открыто сейчас» невозможно протестировать детерминированно.
 *
 * Используется ДВАЖДЫ в кодовой базе EP-06/EP-08: `SearchMedicinesUseCase` (фильтры
 * `openNowOnly`/`is24x7Only`, DTJ-188) и `GetPharmacyMapPinsUseCase` (поле `isOpenNow`
 * на пине карты, DTJ-196) — оба получают этот класс через DI, ни один не дублирует
 * алгоритм у себя (DRY, C15). DI-регистрация в `catalog.module.ts` (barrel, D-27) и
 * биндинг продакшен-адаптера `TENANT_CLOCK` — задача первого потребителя (DTJ-188/196):
 * без реализации порта Nest не смог бы разрешить зависимость при старте, а этот тикет
 * не владеет файлом infrastructure-адаптера (см. JSDoc `clock.port.ts`).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-046, SRS-CAT-047)
 * @see tickets/ep05-search-map/DTJ-184.md
 */
import { Inject, Injectable } from '@nestjs/common'
import type { TenantId } from '@/modules/tenancy/index.js'
import { TENANT_CLOCK, TimeOfDay, type Clock } from '../ports/clock.port.js'

/** Данные аптеки, необходимые политике. Подмножество `Pharmacy`-агрегата (`onboarding`/`catalog`). */
export interface PharmacyOpeningHoursInput {
  readonly is24x7: boolean
  readonly openingTime: TimeOfDay
  readonly closingTime: TimeOfDay
}

export interface PharmacyOpeningHoursResult {
  readonly isOpenNow: boolean
}

/**
 * Чистая функция — ДОСЛОВНО алгоритм `SRS-CAT-046`. Обрабатывает интервал, переходящий
 * через полночь (`closing < opening`, например аптека работает `20:00–02:00`): в этом
 * случае «открыто» — это ночная часть (`now >= opening`) ИЛИ утренняя (`now <= closing`),
 * а не пересечение обеих. Вырожденный интервал `opening === closing` формально попадает
 * в ветку «обычный интервал» (`closing >= opening` истинно при равенстве) и открыт ровно
 * одну минуту — поведение зафиксировано намеренно, не побочный эффект.
 */
export function isOpenNow(now: TimeOfDay, opening: TimeOfDay, closing: TimeOfDay): boolean {
  if (closing >= opening) {
    return now >= opening && now <= closing
  }
  return now >= opening || now <= closing
}

/**
 * «24/7» — независимый предикат (`SRS-CAT-047`). Намеренно ОТДЕЛЬНАЯ функция, не смешанная
 * с `isOpenNow`: вызывающий код (`SearchMedicinesUseCase`) применяет фильтры `openNowOnly`
 * и `is24x7Only` независимо друг от друга.
 */
export function isTwentyFourSeven(pharmacy: { readonly is24x7: boolean }): boolean {
  return pharmacy.is24x7
}

@Injectable()
export class PharmacyOpeningHoursPolicy {
  constructor(@Inject(TENANT_CLOCK) private readonly clock: Clock) {}

  /**
   * «Открыто сейчас» = `is24x7 === true` ИЛИ время суток тенанта попадает в интервал
   * `[openingTime, closingTime]`. Круглосуточная аптека короткозамыкает результат ДО
   * обращения к `clock`/`isOpenNow` — `openingTime`/`closingTime` для неё нерелевантны
   * и НЕ читаются, даже если в них плейсхолдер-мусор (критерий приёмки DTJ-184 №3).
   */
  evaluate(pharmacy: PharmacyOpeningHoursInput, tenantId: TenantId): PharmacyOpeningHoursResult {
    if (isTwentyFourSeven(pharmacy)) {
      return { isOpenNow: true }
    }
    const now = this.clock.nowInTenantTz(tenantId)
    return { isOpenNow: isOpenNow(now, pharmacy.openingTime, pharmacy.closingTime) }
  }
}
