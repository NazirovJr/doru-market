/**
 * Re-export канонического `InvalidCoordinatesError` из `@dorutj/contracts`
 * (EP-01, DTJ-005/009, SRS-DOM-072).
 *
 * `files_owned` тикета DTJ-009 требует этот файл в `shared-kernel/domain/errors/`.
 * Сам класс живёт в `packages/contracts` (EP-01 DTJ-005, единственный каталог
 * domain errors), мы лишь делаем удобный алиас-импорт.
 */
export { InvalidCoordinatesError } from '@dorutj/contracts'
