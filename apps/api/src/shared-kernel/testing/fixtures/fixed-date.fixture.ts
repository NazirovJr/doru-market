/**
 * Тестовая фикстура для доменных спеков `shared-kernel` (Ж3: без
 * `eslint-disable`). Папка `testing/` — НЕ `domain/`, поэтому
 * `no-restricted-globals` на неё не распространяется: сюда вынесено
 * единственное место, где спека вправе построить конкретный `Date` из
 * ISO-строки. Домен по-прежнему не конструирует `Date` сам — он получает
 * его либо через порт `Clock`, либо (в тестах) отсюда.
 */
export function fixedDate(iso: string): Date {
  return new Date(iso)
}
