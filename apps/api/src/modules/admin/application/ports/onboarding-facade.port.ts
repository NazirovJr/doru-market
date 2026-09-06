/**
 * DI-токен `ONBOARDING_FACADE_PORT` (DTJ-350, EP-15) — сужение `OnboardingFacade`
 * (`@/modules/onboarding`, DTJ-070) до методов, реально нужных use case'ам `admin`
 * (Interface Segregation, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3). `admin` не имеет
 * собственного домена (`SRS-ADM-002`) — читает `PharmacyChain`/`PharmacyAccount` ТОЛЬКО
 * через этот порт, прямой импорт `modules/onboarding/domain/*` запрещён (§1.1/§1.2,
 * ловится `pnpm arch:check`).
 *
 * Тип порта ПОКА не объявлен — первый метод (напр. `findPharmacyAccounts(filter):
 * Promise<Page<PharmacyAccountSummaryDto>>`) добавит тикет, которому он реально нужен
 * (DTJ-351..367), тем же приёмом, что `PAYMENTS_FACADE` в `modules/payments/index.ts`:
 * пустой `interface {}` запрещён `@typescript-eslint/no-empty-object-type`, а типизировать
 * несуществующие методы заранее нельзя. До первого потребителя `admin.module.ts` связывает
 * токен с РЕАЛЬНЫМ `OnboardingFacade` через `useExisting` — TypeScript не требует, чтобы
 * токен уже имел объявленный интерфейс для этой привязки.
 *
 * // заполняется тикетами DTJ-351..367
 */
export const ONBOARDING_FACADE_PORT = Symbol.for('@dorutj/admin/onboarding-facade-port')
