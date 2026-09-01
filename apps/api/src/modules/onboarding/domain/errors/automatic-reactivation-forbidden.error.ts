/**
 * `AutomaticReactivationForbiddenError` (SRS-DOM-050, REQ-ONBOARD-17):
 * попытка прямого `PharmacyAccount.activate()` из `'suspended'` В ОБХОД
 * `requestReactivation()` → одобрения оператора super_admin.
 *
 * Канонический класс `AutomaticReactivationForbiddenError` уже определён
 * в `packages/contracts/src/domain-errors.ts` с кодом
 * `INVALID_STATE_TRANSITION` (409). Этот файл — алиас-реэкспорт, чтобы
 * use case'ы onboarding'а импортировали ошибку из своего модуля без
 * пересечения границ bounded context'а напрямую с чужими
 * модульными файлами (одинаковая конвенция с `parent-chain-not-active.error.ts`).
 */
export { AutomaticReactivationForbiddenError } from '@dorutj/contracts'
