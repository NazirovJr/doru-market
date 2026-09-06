/**
 * Публичный барабан модуля `notifications` (D-27, DTJ-368, EP-16).
 *
 * Прямой импорт `modules/notifications/domain|application|infrastructure|presentation` из другого
 * модуля — блокирующее нарушение `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2 (ловится
 * `pnpm arch:check`). Импортируйте только из этого файла.
 *
 * На этом тикете ничего, кроме модуля, наружу не нужно — ни один другой модуль ещё не потребляет
 * `notifications` (диспетчер `DTJ-370` работает ВНУТРИ этого модуля). Экспорты портов/токенов
 * добавляются строкой, когда появится первый внешний потребитель.
 */
export { NotificationsModule } from './notifications.module.js'
