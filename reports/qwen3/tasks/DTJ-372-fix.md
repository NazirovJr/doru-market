# ЗАДАНИЕ DTJ-372-fix — лента уведомлений: исправления по ревью

> Прочитай этот файл целиком одним вызовом `read`. Инструмент сам печатает в конце вывода
> `(End of file - total N lines)` — эта пометка и значит, что файл прочитан весь;
> последняя строка файла — `=== КОНЕЦ ЗАДАНИЯ DTJ-372-fix ===`. Пометки нет — дочитай
> остаток через `read` с `offset` и только потом работай.
> Если история сжата или ты не помнишь следующий шаг — перечитай этот файл: `reports/qwen3/tasks/DTJ-372-fix.md`.
>
> **Проверка и сдача — только этими двумя командами**, других способов нет. Они стоят в начале
> намеренно: когда история разрастается, dsh вырезает середину длинных результатов `read`, а начало
> оставляет. Видишь в выводе `[... tool result middle pruned ...]` — середина вырезана: нужный
> раздел перечитай через `read` с `offset`/`limit`. В вызове `pwsh` — всегда `timeoutMs: 600000`.
> `git add` и `git commit` не вызывай никогда: коммит делает только гейт с `-Commit`.
>
> Проверка:
> `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Allowed 'apps/api/src/modules/notifications/*','apps/api/src/modules/notifications/**/*','packages/contracts/src/notifications.ts','packages/contracts/src/index.ts' -RequireFile reports/qwen3/tasks/DTJ-372-fix.require.txt`
>
> Сдача (раздел 8) — та же команда с `-Commit`:
> `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Allowed 'apps/api/src/modules/notifications/*','apps/api/src/modules/notifications/**/*','packages/contracts/src/notifications.ts','packages/contracts/src/index.ts' -RequireFile reports/qwen3/tasks/DTJ-372-fix.require.txt -Commit "fix(notifications): DTJ-372 — filter[status], InvalidCursorError, DTO и роли по тикету"`

## 0. Карточка задачи

Цель: довести `GET /api/v1/notifications` до требований тикета DTJ-372. Первый коммит (`595b67d`,
твой) уже лежит в ветке; ревью нашло в нём ошибки. Исправляешь ровно их — раздел 2.

В отличие от первого задания, здесь **все решения приняты за тебя**: типы, поля и сигнатуры в
разделе 2 заданы точно. Делай ровно так. Своих полей, типов и файлов не придумывай.

Меняешь ровно эти файлы:

СОЗДАТЬ:
- `apps/api/src/modules/notifications/presentation/notifications-query.util.ts`
- `apps/api/src/modules/notifications/presentation/notifications-query.util.spec.ts`
- `apps/api/src/modules/notifications/presentation/notification-summary.mapper.ts`
- `apps/api/src/modules/notifications/presentation/notification-summary.mapper.spec.ts`

ИЗМЕНИТЬ:
- `packages/contracts/src/notifications.ts` — DTO по тикету
- `apps/api/src/modules/notifications/application/ports/notifications-repository.port.ts` — вход `list()`
- `apps/api/src/modules/notifications/application/use-cases/list-own-notifications.use-case.ts`
- `apps/api/src/modules/notifications/application/use-cases/list-own-notifications.use-case.spec.ts`
- `apps/api/src/modules/notifications/presentation/notifications-feed.controller.ts`
- `apps/api/src/modules/notifications/presentation/notifications-feed.controller.spec.ts`
- `apps/api/src/modules/notifications/infrastructure/providers/in-app-notify.provider.spec.ts` — убрать лишний импорт
- `apps/api/src/modules/notifications/notifications.module.ts` — вернуть первую строку шапки

Любой другой файл не трогай. Понадобилось — это СТОП (раздел 7).

Первое действие — `todo_write`. Первый пункт — цель задания одной фразой своими словами,
дальше шаги раздела 4: все до единого, по пункту на шаг, ничего не сокращая и не объединяя.
В разделе 4 ровно 9 шагов, значит в списке будет 10 пунктов. Получилось меньше — список
неверный, перепиши его целиком. Последние шаги (гейт и сдача) выкидывать нельзя: пока гейт не
напечатал строку `КОММИТ:`, работа не сделана, чем бы ни кончился твой список дел.
Второе — `git status --short`: пусто — работай, есть чужие изменения — это СТОП (раздел 7).
Третье — убедись, что работаешь в своей ветке: `git branch --show-current` должен показать
`feat/dtj-372-notifications-feed`. Показывает другое — создай её: `git checkout -b feat/dtj-372-notifications-feed development`.

## 1. Среда — как пользоваться инструментами

**Главное правило dsh:** не пиши текст перед вызовом инструмента — сразу вызывай инструмент.
Сообщение без вызова инструмента dsh считает концом работы. Текст пишешь один раз — в отчёте из раздела 8.

1. `pwsh` — это Windows PowerShell 5.1. В нём НЕТ: `&&`, `||`, `grep`, `find -name`, `cat`, `sed`,
   `rm -rf`, `del /s /q`. Несколько команд подряд — через `;`.
2. Каждый вызов `pwsh` — новый процесс, `cd` не сохраняется. Нужна другая папка — параметр `workdir`.
3. Искать текст — инструмент `grep`, всегда с `path` (`apps/...` или `packages/...`). Искать файл —
   `glob`. Читать — `read`: файлы длиннее 200 строк — частями через `offset`/`limit`. Менять — `edit`.
4. Всё под `.claude/`, `dist/`, `coverage/`, `node_modules/` — старые копии и сборки. Не читать и не править.
5. В импортах пишется `.js` (`'./x.use-case.js'`), а на диске лежит `x.use-case.ts`. Открывай `.ts`.
6. `edit`: перед каждой правкой перечитай этот кусок файла. `old_string` копируй из вывода `read`
   дословно, без номеров строк. `new_string` обязан отличаться от `old_string`. `replace_all` не используй.
   Один вызов не должен нести больше ~100 строк кода. Длинный файл создавай в два-три приёма.
7. Проверка — только команда гейта из шапки. `npx eslint`, `pnpm test`, `pnpm typecheck` и прочие
   свои проверки не запускай: гейт гоняет всё это сам и показывает причину первой строкой.
   Последняя строка вывода — `GATE: PASS` или `GATE: FAIL -> <что упало>`. Над ней — ошибки с `файл(строка)`.
8. git: можно `git status` и `git diff`. Нельзя: `add`, `commit`, `merge`, `rebase`, `push`, `reset`,
   `stash`, переключаться на чужие ветки. Коммит делает гейт с `-Commit` (раздел 8).
   git в песочнице dsh иногда печатает `couldn't create signal pipe, Win32 error 5` и отдаёт
   `exit code: 1`, хотя команда выполнена. Смотри на результат, а не на код возврата.

## 2. Что исправить — решения приняты, делай ровно так

**Проверенные факты о библиотеках** (на них ушёл час первого прогона):

- Zod 4 (`zod@4.4.3`): `z.enum(МАССИВ)` — ОДИН аргумент, сам массив `as const`, без `...`.
  `z.record(ключ, значение)` — ДВА аргумента. Необязательное поле — `.optional()`, может быть
  `null` — `.nullable()`.
- `МАССИВ_as_const.includes(строка)` не компилируется, если `строка` — просто `string`. Нужен
  тип-гард: `function isX(v: string): v is X { return (МАССИВ as readonly string[]).includes(v) }`.
- `@dorutj/contracts` уже экспортирует: `cursorQuerySchema`, тип `CursorQuery`, `encodeCursor`,
  `decodeCursor`, тип `PaginationMeta`, `ok`, тип `SuccessEnvelope`, `USER_ROLES` (все шесть ролей),
  `ValidationError(message, details?)`, `InvalidCursorError(message, details?)`.
- `@/modules/auth/index.js` экспортирует: `AuthGuard`, `RolesGuard`, `Roles`, `ROLES_METADATA_KEY`,
  `CurrentUser`, тип `JwtClaims`. У `JwtClaims` поле `tenantId: string | null` (у `super_admin` — `null`).
- `@Roles(...ролей)` принимает роли списком: `@Roles(...USER_ROLES)` — все шесть.
- Fastify читает `?filter[status]=queued,sent` как ОДИН плоский ключ со скобками в имени:
  `@Query('filter[status]') statusRaw: string | undefined`. Так уже сделано в
  `orders/presentation/pharmacy-terminal/pharmacy-terminal-queue.controller.ts` (`filter[pharmacyId]`).
- Импортировать из чужого модуля можно только через его `index.js`. Файлы модуля `payments` и
  `support` — только образцы для чтения, не импортируй из них: `arch:check` покраснеет.

**2.1 Контракт `packages/contracts/src/notifications.ts`.** `NOTIFICATION_STATUS_VALUES`,
`NOTIFICATION_CHANNEL_VALUES` и их типы оставь. `NotificationSummarySchema` — ровно эти семь полей
(тикет, раздел «Что сделать», п.3):

| поле | схема | откуда |
|---|---|---|
| `id` | `z.string()` | запись |
| `eventType` | `z.string().nullable()` | `record.eventType`, нет — `null` |
| `channel` | `z.enum(NOTIFICATION_CHANNEL_VALUES)` | запись |
| `status` | `z.enum(NOTIFICATION_STATUS_VALUES)` | запись |
| `payload` | `z.object({ subject: z.string().optional(), body: z.string() })` | уже отрендеренный текст |
| `createdAt` | `z.string()` | ISO-строка |
| `sentAt` | `z.string().nullable()` | ISO-строка или `null` |

Полей `userId`, `tenantId`, `failedReason` в схеме нет: свои `userId` и тенант клиенту не нужны,
а `failedReason` — диагностика доставки, её видит только `super_admin` на отдельном экране (DTJ-373).
Слов `userId`, `tenantId`, `failedReason` в этом файле не должно быть вовсе, даже в комментариях.

**2.2 Порт.** `ListNotificationsCursor` и `ListNotificationsPage` не меняй. `ListNotificationsInput` —
ровно так:

| поле | тип | смысл |
|---|---|---|
| `userId` | `string` | чья лента |
| `tenantId` | `string \| null` | `null` — актор без тенанта (`super_admin`): фильтр только по `userId` |
| `statuses` | `readonly NotificationStatus[] \| undefined`, поле необязательное | не передан — все статусы |
| `order` | `'createdAt:desc'` | единственный порядок ленты: новые сверху |
| `limit` | `number` | |
| `cursor` | `ListNotificationsCursor \| null` | |

Над методом `list()` — JSDoc в две строки: страница ленты пользователя; сортировка `createdAt`
по убыванию, при равенстве — `id` по убыванию; курсор — `{ v: createdAt в ISO, id }` последней
записи; реализация — DTJ-370.

**2.3 Use case.** Команда: `actor: { userId: string; tenantId: string | null }`,
`statuses?: readonly NotificationStatus[] | undefined`, `limit: number`,
`cursor: ListNotificationsCursor | null`. В порт отдаёт `userId` и `tenantId` из `actor`, `statuses`
как есть, `order: 'createdAt:desc'` всегда, `limit`, `cursor`. Результат:
`{ items: readonly NotificationRecord[]; nextCursor: ListNotificationsCursor | null; hasMore: boolean }` —
записи как есть. Никакого `NotificationSummary`, `toISOString` и своего типа курсора в use case —
преобразование к DTO делает presentation (п.2.5), курсор — тип порта. Слов `NotificationSummary`,
`toISOString` и `ListOwnNotificationsCursor` в файле use case не должно быть вовсе, даже в комментариях.

**2.4 `presentation/notifications-query.util.ts`** — две функции (образцы: `parseListCursor` в
`support/presentation/support-tickets-query.util.ts`, `parseStatusesFilter` в
`payments/presentation/pharmacy-accounts-reports/pharmacy-accounts-report-query.util.ts`):

- `parseListCursor(raw: string | undefined): ListNotificationsCursor | null` — `undefined` → `null`;
  `decodeCursor` вернул `null` или `v` не строка → `throw new InvalidCursorError(...)`.
- `parseStatusFilter(raw: string | undefined): readonly NotificationStatus[] | undefined` —
  `undefined` или пустая строка → `undefined`; иначе режь по запятой, `trim`, пустые выкинь; каждое
  значение проверь тип-гардом по `NOTIFICATION_STATUS_VALUES`; чужое → `throw new ValidationError(...)`.

**2.5 `presentation/notification-summary.mapper.ts`** — `toNotificationSummary(record: NotificationRecord): NotificationSummary`
по таблице п.2.1. `payload.body` — строка из `record.payload.body`, иначе `''`; `subject` кладётся,
только если `record.payload.subject` — строка (`typeof ... === 'string'`).

**2.6 Контроллер.** На классе: `@Controller({ path: 'notifications', version: '1' })`,
`@UseGuards(AuthGuard, RolesGuard)`, `@Roles(...USER_ROLES)` — тикет требует явный список всех
шести ролей. Метод:
`list(@Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery, @Query('filter[status]') statusRaw: string | undefined, @CurrentUser() claims: JwtClaims)`.
В use case: `actor: { userId: claims.sub, tenantId: claims.tenantId }`,
`statuses: parseStatusFilter(statusRaw)`, `limit: query.limit`, `cursor: parseListCursor(query.cursor)`.
Ответ: `ok(result.items.map(toNotificationSummary), { pagination: meta })`, где `meta` — как сейчас.
Убрать: `requireTenantId` (тикет: 200 для всех шести ролей, включая `super_admin`), свой `parseCursor`,
свой интерфейс курсора, повторные `import` из одного модуля (по одному на модуль), из JSDoc — абзац
про то, где контроллер был раньше, и упоминание `AuthSizePolicy` (такого нет).

**2.7 Мелочи.** В `in-app-notify.provider.spec.ts` убери строку `type ListNotificationsPage as _ListNotificationsPage,`.
В `notifications.module.ts` верни первую строку шапки как было: `(EP-16, DTJ-368)` вместо
`(EP-16, DTJ-368/372)` — шапку этого файла можно только дополнять строками.

## 3. Образцы — открой и сделай так же

| Что делаешь | Образец |
|---|---|
| Разбор курсора | `apps/api/src/modules/support/presentation/support-tickets-query.util.ts` |
| Разбор списка статусов | `apps/api/src/modules/payments/presentation/pharmacy-accounts-reports/pharmacy-accounts-report-query.util.ts` |
| Ключ `filter[...]` в `@Query` | `apps/api/src/modules/orders/presentation/pharmacy-terminal/pharmacy-terminal-queue.controller.ts` |
| Маппер в DTO | `apps/api/src/modules/support/presentation/mappers/support-ticket.mapper.ts` |

## 4. План — строго по порядку

Шаг 1. Контракт `packages/contracts/src/notifications.ts` — п.2.1.
Шаг 2. Порт — п.2.2.
Шаг 3. Use case — п.2.3.
Шаг 4. `notifications-query.util.ts` и его спек — п.2.4 и раздел 5.
Шаг 5. `notification-summary.mapper.ts` и его спек — п.2.5 и раздел 5.
Шаг 6. Контроллер — п.2.6.
Шаг 7. Спеки use case и контроллера — раздел 5.
Шаг 8. Мелочи — п.2.7.
Шаг 9. Гейт и сдача — раздел 8.

## 5. Тесты — что именно должно быть проверено

Гейт читает `reports/qwen3/tasks/DTJ-372-fix.require.txt`: строки, которые обязаны быть в файлах, и
строки (с `!`), которых там быть не должно. Строка ищется буквально — перефраз не засчитывается.

`list-own-notifications.use-case.spec.ts`:
- тест с именем, где буквально есть «userId из актора», — оставь.
- `super_admin` без тенанта: в порт уходит `tenantId: null`.
- `statuses` `['queued', 'sent']` уходит в порт как есть.
- порт всегда получает `order: 'createdAt:desc'`.
- `nextCursor` и `hasMore` приходят из порта без изменений — назови тест ровно так; старое имя
  «когда порт вернул строк больше, чем limit» убери: use case этого не считает.

`notifications-query.util.spec.ts`:
- `'queued,sent'` → `['queued', 'sent']`; `' queued , ,sent '` → то же; `undefined` → `undefined`.
- неизвестный статус (`'deleted'`) → бросает `ValidationError`.
- мусор вместо курсора (`'not-a-cursor'`) → бросает `InvalidCursorError`; `encodeCursor({ v, id })` → `{ v, id }`.

`notification-summary.mapper.spec.ts`:
- полная запись → `toStrictEqual` с DTO ровно из семи полей п.2.1: лишнего ключа быть не может.
- запись без `eventType` и без `subject` → `eventType: null`, `payload: { body }`.

`notifications-feed.controller.spec.ts`:
- роли: `new Reflector().get(ROLES_METADATA_KEY, NotificationsFeedController)` равно `USER_ROLES`
  (`Reflector` — из `@nestjs/core`), среди них `courier`.
- `super_admin` с `tenantId: null` получает ответ, а в use case уходит `actor` с `tenantId: null`.
- `statusRaw` `'queued,sent'` доходит до use case как `statuses: ['queued', 'sent']`.
- ответ: `ok(...)` с `pagination`; `nextCursor` из use case приходит закодированным `encodeCursor`;
  элементы — DTO без `failedReason`.

## 6. Запреты — нарушение = работа не принята

- Не комментируй и не удаляй существующий код, чтобы прошла проверка. Не заменяй `throw` на `return`.
- Не пиши `it.skip`, `@ts-ignore`, `@ts-expect-error`, `as any`, `: any`. `eslint-disable` не добавляй.
- Не создавай новые папки, npm-пакеты, README и файлы-отчёты.
- `import type` — только для того, что используется исключительно как тип. Класс, декоратор,
  функция, DI-токен → обычный `import`. Один `import` на модуль.
- Каждый параметр конструктора Nest-класса — с `@Inject(ТОКЕН или Класс)`. Это проверяет `test:arch`.
- Числа в коде (кроме тестов) — именованные константы. Функция ≤ 40 строк, файл ≤ 300 строк кода.
- Неиспользуемый импорт не переименовывай в `_имя` — удаляй.

## 7. СТОП — прекрати работу и сдай отчёт со статусом BLOCKED, если

1. `git status --short` в начале работы не пустой.
2. `grep` не находит символ, который ты собираешься импортировать или вызвать.
3. Нужно изменить файл, которого нет в разделе 0.
4. Гейт падает с одной и той же ошибкой два раза подряд после твоих исправлений.
5. `edit` дважды ответил «file changed since it was read» — файл правит кто-то ещё.
6. Задание противоречит коду: метода, поля или файла нет там, где сказано.
7. В выводе гейта есть «ЭТО НЕ ОШИБКА КОДА…» — это среда, а не твой код. Код не трогай, делай, что там написано.

BLOCKED с точной причиной — нормальный результат. Выдуманное DONE — провал.

## 8. Сдача

1. Сдача — одна команда: гейт с `-Commit` из шапки этого файла. В вызове `pwsh` обязательно
   `timeoutMs: 600000`. Гейт сам включает полный режим и коммитит ТОЛЬКО при полностью зелёном
   прогоне, только файлы из `-Allowed` и только в твою ветку. Красный гейт — коммита нет: чини
   ошибки из вывода и запускай ту же команду снова. `git add` и `git commit` сам не вызывай никогда.
2. Ты закончил тогда и только тогда, когда в выводе есть строка `КОММИТ:` с хэшем, а последняя
   строка — `GATE: PASS`. `GATE: PASS` без `-Commit` — это только проверка, а не сдача.
3. Ответ — строго по форме, без пересказа кода:

```
СТАТУС: DONE | BLOCKED
КОММИТ:
<строка КОММИТ: из вывода гейта, дословно>
ГЕЙТ:
<последние 15 строк вывода гейта, дословно>
ОТКЛОНЕНИЯ: <что сделано не так, как написано, и почему — или «нет»>
БЛОКЕРЫ: <или «нет»>
```

4. Отчёт написан — работа закончена. Цель не закрывай и `update_goal` не вызывай: это делает
   координатор. Дальше ничего не делай и жди.

=== КОНЕЦ ЗАДАНИЯ DTJ-372-fix ===
