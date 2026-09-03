/**
 * `PaymentProviderError` — базовый класс доменных ошибок `PaymentProvider` (EP-10, DTJ-237,
 * `21-module-orders-payments-escrow.md` §3.1). `02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.5:
 * доменные ошибки — свои классы, НЕ `HttpException` — маппинг на HTTP-код происходит в
 * `presentation` (будущий тикет, обработчик вебхука/контроллер диагностики платежа).
 *
 * Локальное определение (не `packages/contracts`), тот же приём, что `modules/catalog/domain/
 * errors/domain-error.ts`/`modules/inventory/domain/errors/domain-error.ts` — `domain/` модуля
 * `payments` не зависит от общего каталога ошибок EP-01, остаётся переносимым без инфраструктуры.
 *
 * Конкретна (instantiable), не `abstract`: адаптеры провайдера (`MockBankProvider`, DTJ-238;
 * `AlifMobiProvider`/`DcNextProvider`, R3) конструируют её напрямую для generic-сбоев сети/
 * банка, для которых пока нет отдельного специфичного подкласса — `NotSupportedByProviderError`
 * (см. соседний файл) — единственный подкласс, объявленный этим тикетом.
 *
 * Параметр-свойства конструктора (`readonly code`/`readonly details`), не отдельные `this.x =
 * x` — тот же идиом, что `packages/contracts/src/domain-error-base.ts`: с
 * `exactOptionalPropertyTypes: true` (`tsconfig.base.json`) ручное присваивание
 * `this.details = details` из опционального параметра в опциональное свойство падает `TS2412`
 * («Record<...> | undefined» не назначаемо `Record<...>`) — параметр-свойство этого не имеет
 * (TypeScript обрабатывает объявление и присваивание как единый механизм).
 */
export class PaymentProviderError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = new.target.name
  }
}
