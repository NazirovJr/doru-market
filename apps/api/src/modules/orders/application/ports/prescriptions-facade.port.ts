/**
 * Порт `PrescriptionsFacadePort` (EP-09, DTJ-220, SRS-ORD-015/018 шаг 4a).
 *
 * Межмодульный фасад `orders → prescriptions` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2).
 * Вызывается ПЕРВЫМ в цикле обработки группы checkout (SRS-ORD-018 шаг 4a) — Rx-позиции без
 * верифицированного рецепта исключаются из ПОПЫТКИ (`meta.excludedItems`, SRS-ORD-015), не
 * блокируют оформление остальных позиций той же аптеки.
 *
 * Владеющий модуль `prescriptions` не закреплён ни за одним EP в `tickets/00-EPICS.md` на
 * момент DTJ-220 (см. отчёт, `foundIssues`) — реализация порта и DI-биндинг откладываются до
 * назначения тикета. Здесь — ТОЛЬКО контракт.
 */

/** DI-токен для провайдера `PrescriptionsFacadePort`. */
export const PRESCRIPTIONS_FACADE_PORT = Symbol.for('@dorutj/orders/prescriptions-facade')

export interface PrescriptionsFacadePort {
  /**
   * `true`, если у `customerId` есть ХОТЯ БЫ ОДИН верифицированный (`prescription_status =
   * 'verified'`) рецепт, покрывающий КАЖДЫЙ из `medicineIds` (SRS-ORD-015). Семантика
   * «покрытия» одного рецепта несколькими позициями — решение модуля `prescriptions`, не
   * этого порта.
   */
  isVerifiedFor(customerId: string, medicineIds: readonly string[]): Promise<boolean>
}
