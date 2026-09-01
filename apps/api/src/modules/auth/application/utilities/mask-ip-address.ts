/**
 * `maskIpAddress` (EP-01, DTJ-026, SRS-API-149) — маскирование IP-адреса перед
 * отдачей клиенту. Последний октет IPv4 / последний блок IPv6 заменяется
 * на `*`. Это PRESENTATION-уровневое преобразование; в БД `ip_address`
 * остаётся ПОЛНЫМ для security-расследований.
 *
 * `maskIpAddress` НЕ бизнес-правило, а форматирование вывода. Тикет
 * DTJ-026 §3.3 явно допускает вызов из application-слоя для формирования
 * DTO, «приемлемо, т.к. маскирование не бизнес-правило, а форматирование
 * вывода; альтернативно вынести в presentation-маппер, если ревью сочтёт
 * более чистым — не блокирующее расхождение».
 *
 * Форматы:
 *   - IPv4:  `192.168.1.42`       → `192.168.1.*`     (3 октета сохраняются)
 *   - IPv4:  `10.0.0.1`            → `10.0.0.*`
 *   - IPv6:  `2001:0db8:85a3:0000:0000:8a2e:0370:7334` → `2001:0db8:85a3:0000:0000:8a2e:0370:*`
 *     (7 блоков сохраняются, последний заменяется на `*`)
 *   - Невалидный формат: возвращается AS-IS + `*` (не парсим строго — это
 *     форматирование, не валидация; при некорректной БД-записи не хочется
 *     бросать 500 на `GET /auth/sessions`).
 *
 * Максимальная длина IP в `auth_sessions.ip_address` — VARCHAR(45)
 * (IPv4 = 15 chars, IPv6 = 39 chars, +запас).
 */
const IPV4_DOT_COUNT = 3
const IPV4_OCTET_INDEX_FOR_MASK = 3
const IPV6_COLON_COUNT = 7
const IPV6_BLOCK_INDEX_FOR_MASK = 7

export function maskIpAddress(ip: string): string {
  if (ip.length === 0) {
    return '*'
  }
  // IPv4 — содержит точки, нет двоеточий.
  if (ip.includes('.') && !ip.includes(':')) {
    const parts = ip.split('.')
    if (parts.length === IPV4_DOT_COUNT + 1) {
      parts[IPV4_OCTET_INDEX_FOR_MASK] = '*'
      return parts.join('.')
    }
    return `${ip}.*`
  }
  // Один октет без точек вообще (`'192'`) — тоже похоже на обрезанный/невалидный
  // IPv4 (полностью цифровая строка), а не произвольный "мусор". Тот же
  // fallback `${ip}.*`, что и для IPv4 с неполным числом точек выше — отличаем
  // от строки #7 ('garbage' → 'garbage*', без точки).
  if (/^\d+$/u.test(ip) && !ip.includes(':')) {
    return `${ip}.*`
  }
  // IPv6 — содержит двоеточия.
  if (ip.includes(':')) {
    const parts = ip.split(':')
    if (parts.length === IPV6_COLON_COUNT + 1) {
      parts[IPV6_BLOCK_INDEX_FOR_MASK] = '*'
      return parts.join(':')
    }
    // Неполный / compressed IPv6 — маскируем «последний известный блок»
    // (для записи из БД, скорее всего, корректный формат; этот fallback
    // для отладки и edge-кейсов).
    return `${ip.split(':').slice(0, -1).join(':')}:*`
  }
  // Неизвестный формат — добавляем `*` в конец (НЕ возвращаем сырой IP).
  return `${ip}*`
}
