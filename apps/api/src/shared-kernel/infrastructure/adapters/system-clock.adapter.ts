/**
 * `SystemClockAdapter` (EP-01, DTJ-006) — production-реализация `Clock`.
 *
 * Использует `Date.now()` через адаптер: domain/application не вызывают его напрямую.
 */
import { Injectable } from '@nestjs/common'
// Внутренний импорт — ПРЯМО из файла через алиас `@/...` (D-27: barrel — только
// для межмодульного использования, иначе цикл `module → barrel → module`).
import { type Clock } from '@/shared-kernel/application/ports/clock.port.js'

@Injectable()
export class SystemClockAdapter implements Clock {
  now(): Date {
    return new Date()
  }
}
