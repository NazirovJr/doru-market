# ЗАДАНИЕ DTJ-307b — SLA сборки: метод `getPickupSlaBufferMinutes` в `TenancyFacadePort`

> Прочитай этот файл целиком одним вызовом `read`. Инструмент сам печатает в конце вывода
> `(End of file - total N lines)` — эта пометка и значит, что файл прочитан весь;
> последняя строка файла — `=== КОНЕЦ ЗАДАНИЯ DTJ-307b ===`. Пометки нет — дочитай
> остаток через `read` с `offset` и только потом работай.
> Если история сжата или ты не помнишь следующий шаг — перечитай этот файл: `reports/qwen3/tasks/DTJ-307b.md`.

> Координатору перед отправкой: DTJ-307a влит в `development`, ветка этого задания создана от него.

## 0. Карточка задачи

Цель: добавить в порт `TenancyFacadePort` метод `getPickupSlaBufferMinutes(tenantId)` — буфер SLA
сборки из `tenant_settings.pickup_sla_buffer_minutes`, дефолт 5. Реализовать его в адаптере и
добавить во все моки порта, чтобы ни один спек не сломался.
Рабочая папка — та, что открыта в этой сессии dsh (общий репозиторий, в нём работают и другие).
Меняешь ровно эти файлы:

ИЗМЕНИТЬ:
- `apps/api/src/modules/orders/application/ports/tenancy-facade.port.ts` — объявление метода
- `apps/api/src/modules/orders/infrastructure/adapters/tenancy-facade.adapter.ts` — константа дефолта и реализация
- `apps/api/src/modules/orders/infrastructure/adapters/tenancy-facade.adapter.spec.ts` — два теста
- моки порта (одна строка в каждом, список в разделе 3.4):
  - `apps/api/src/modules/orders/application/checkout/calculate-order-cost.service.spec.ts`
  - `apps/api/src/modules/orders/application/checkout/checkout.use-case.spec.ts`
  - `apps/api/src/modules/orders/application/pharmacy-terminal/accept-order.use-case.spec.ts`
  - `apps/api/src/modules/orders/application/pharmacy-terminal/propose-partial-fulfillment.use-case.spec.ts` (два места)
  - `apps/api/src/modules/orders/application/pharmacy-terminal/regenerate-handover-otp.use-case.spec.ts`
  - `apps/api/src/modules/orders/application/pharmacy-terminal/report-picking-sla-breach.use-case.spec.ts`
  - `apps/api/src/modules/orders/application/policies/cod-policy.service.spec.ts`
  - `apps/api/src/modules/orders/application/policies/payment-method-enabled-policy.service.spec.ts`
  - `apps/api/test/integration/orders/__tests__/test-app.ts`

Любой другой файл не трогай. Понадобилось — это СТОП (раздел 7).
Не делаешь: кто и где вызывает новый метод (это DTJ-307c), миграции (колонка уже есть), модуль tenancy.

Первое действие — `todo_write`. Первый пункт — цель задания одной фразой своими словами,
дальше шаги раздела 4: все до единого, по пункту на шаг, ничего не сокращая и не объединяя.
В разделе 4 ровно 7 шагов, значит в списке будет 8 пунктов. Получилось меньше — список
неверный, перепиши его целиком. Последние шаги (гейт и сдача) выкидывать нельзя: пока гейт не
напечатал строку `КОММИТ:`, работа не сделана, чем бы ни кончился твой список дел.
Второе — `git status --short`: пусто — работай, есть чужие изменения — это СТОП (раздел 7).
Третье — своя ветка от `development`: `git checkout -b feat/dtj-307b-sla-buffer-setting development`.
Сразу после неё — `git branch --show-current`: в выводе должна быть эта ветка.

## 1. Среда — как пользоваться инструментами

**Главное правило dsh:** не пиши текст перед вызовом инструмента — сразу вызывай инструмент.
Сообщение без вызова инструмента dsh считает концом работы. Текст пишешь один раз — в отчёте из раздела 8.

1. `pwsh` — это Windows PowerShell 5.1. В нём НЕТ: `&&`, `||`, `grep`, `find -name`, `cat`, `sed`,
   `rm -rf`, `del /s /q`. Несколько команд подряд — через `;`.
2. Каждый вызов `pwsh` — новый процесс, `cd` не сохраняется. Нужна другая папка — параметр `workdir`.
3. Искать текст — инструмент `grep`, всегда с `path` (`apps/...` или `packages/...`). Искать файл —
   `glob`. Читать — `read`: файлы длиннее 200 строк — частями через `offset`/`limit`. Менять — `edit`.
   Не читай файл целиком, если нужный кусок уже приведён в задании: чем больше прочитано, тем
   медленнее ты пишешь (20 тыс. токенов истории — 25 слов в секунду, 45 тыс. — уже 12).
4. Всё под `.claude/`, `dist/`, `coverage/`, `node_modules/` — старые копии и сборки. Не читать и не править.
5. В импортах пишется `.js` (`'./x.use-case.js'`), а на диске лежит `x.use-case.ts`. Открывай `.ts`.
6. `edit`: перед каждой правкой перечитай этот кусок файла. `old_string` копируй из вывода `read`
   дословно, без номеров строк. `new_string` обязан отличаться от `old_string`. `replace_all` не используй.
   Один вызов не должен нести больше ~100 строк кода. Пока ты пишешь аргумент, dsh не видит ни
   одного символа и через 20 минут молчания рвёт вызов. Длинный файл создавай в два-три приёма:
   `write` с шапкой и первым тестом, дальше `edit` — по одному тесту.
7. Проверка — только эта команда (в `workdir` = рабочая папка). Свои способы проверки не
   придумывай, кэши не чисти:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Allowed 'apps/api/src/modules/orders/application/ports/tenancy-facade.port.ts','apps/api/src/modules/orders/infrastructure/adapters/tenancy-facade.adapter*','apps/api/src/modules/orders/application/*.spec.ts','apps/api/test/integration/orders/__tests__/test-app.ts' -RequireFile reports/qwen3/tasks/DTJ-307b.require.txt`
   В вызове `pwsh` обязательно укажи `timeoutMs: 600000`: полный гейт идёт до 4 минут, а без этого
   dsh обрывает команду через 2.
   Последняя строка вывода — `GATE: PASS` или `GATE: FAIL -> <что упало>`. Над ней — ошибки с `файл(строка)`.
8. git: можно `git status`, `git diff` и создать свою ветку
   (команды — в разделах 0 и 8). Нельзя: `merge`, `rebase`, `push`, `reset`, `stash`, переключаться
   на чужие ветки. Сам `git commit` не запускай: в песочнице dsh он обрывается на хуках husky.
   Коммит делает гейт с `-Commit` (раздел 8), слияние в `development` — координатор.
   git в песочнице dsh иногда печатает `couldn't create signal pipe, Win32 error 5` и отдаёт
   `exit code: 1`, хотя команда выполнена. Это сбой песочницы, а не git: смотри на результат, а
   не на код возврата — после ветки `git branch --show-current`, после коммита `git log --oneline -1`.

## 2. Проверенные факты (development @ `cd49440` + DTJ-307a, проверено координатором)

### 2.1 Уже есть — используй как есть, заново не создавай
- Колонка `tenant_settings.pickup_sla_buffer_minutes` (дефолт 5) — `apps/api/src/db/schema/tenants.ts`.
  Миграция не нужна.
- Доменная сущность tenancy уже отдаёт это поле: у объекта, который возвращает
  `tenantSettingsRepository.findByTenantId(...)`, есть геттер `pickupSlaBufferMinutes`.
  Поэтому реализация — копия `getPickupSlaMinutes` в том же адаптере (раздел 3.2), без прямого SQL.
- В адаптере уже есть `TenantId` и `tenantSettingsRepository` — новых импортов и параметров конструктора не нужно.

### 2.2 Этого НЕТ — не выдумывай, не ищи
- В порту нет метода `getPickupSlaBufferMinutes` — его добавляешь ты.
- Никакого второго `TenancyFacadePort` в модуле orders нет. В `apps/api/src/modules/payments/` есть
  свой, другой порт с тем же именем — его НЕ трогай.

### 2.3 Ловушки — сломается, если не учесть
- Порт мокается объектами с типом `TenancyFacadePort` в семи спеках (в одном из них — в двух местах).
  Без новой строки в каждом `tsc` падает с `Property 'getPickupSlaBufferMinutes' is missing`.
- `test-app.ts` (интеграционные тесты) собирает объект порта без типа: `tsc` там НЕ упадёт, но
  интеграционный тест упадёт в рантайме. Строку туда добавить обязательно (раздел 3.4, пункт 9).
- В `propose-partial-fulfillment.use-case.spec.ts` строка `getPickupSlaMinutes: vi.fn(),` встречается
  дважды с разным отступом — поэтому там правки по двум строкам (раздел 3.4, пункты 4 и 5).

## 3. Образцы — точные правки

### 3.1 Порт — `tenancy-facade.port.ts`

НАЙДИ:
```ts
  getPickupSlaMinutes(tenantId: string): Promise<number>
```
ЗАМЕНИ НА:
```ts
  getPickupSlaMinutes(tenantId: string): Promise<number>

  /** DTJ-307 (SRS-PHT-033, D-19) — `tenant_settings.pickup_sla_buffer_minutes` (дефолт 5): жёсткий автоотказ через SLA + буфер. */
  getPickupSlaBufferMinutes(tenantId: string): Promise<number>
```

### 3.2 Адаптер — `tenancy-facade.adapter.ts`, две правки

Правка 1. НАЙДИ:
```ts
const PICKUP_SLA_MINUTES_DEFAULT = 7
```
ЗАМЕНИ НА:
```ts
const PICKUP_SLA_MINUTES_DEFAULT = 7

/** DTJ-307 — 1:1 с DB-дефолтом `tenant_settings.pickup_sla_buffer_minutes` (`DEFAULT_PICKUP_SLA_BUFFER_MINUTES`). */
const PICKUP_SLA_BUFFER_MINUTES_DEFAULT = 5
```

Правка 2. НАЙДИ:
```ts
    return settings?.pickupSlaMinutes ?? PICKUP_SLA_MINUTES_DEFAULT
  }
```
ЗАМЕНИ НА:
```ts
    return settings?.pickupSlaMinutes ?? PICKUP_SLA_MINUTES_DEFAULT
  }

  /** DTJ-307 (SRS-PHT-033) — 1:1 с `getPickupSlaMinutes` выше. */
  async getPickupSlaBufferMinutes(tenantId: string): Promise<number> {
    const settings = await this.tenantSettingsRepository.findByTenantId(TenantId.from(tenantId))
    return settings?.pickupSlaBufferMinutes ?? PICKUP_SLA_BUFFER_MINUTES_DEFAULT
  }
```

### 3.3 Спек адаптера — `tenancy-facade.adapter.spec.ts`

НАЙДИ (конец блока `describe('TenancyFacadeAdapter.getPickupSlaMinutes …`):
```ts
    await expect(adapter.getPickupSlaMinutes(TENANT_ID)).resolves.toBe(12)
  })
})
```
ЗАМЕНИ НА:
```ts
    await expect(adapter.getPickupSlaMinutes(TENANT_ID)).resolves.toBe(12)
  })
})

describe('TenancyFacadeAdapter.getPickupSlaBufferMinutes (DTJ-307, SRS-PHT-033)', () => {
  it('настройки тенанта отсутствуют (findByTenantId → null) → дефолт 5 минут (D-19)', async () => {
    const adapter = makeAdapter()
    await expect(adapter.getPickupSlaBufferMinutes(TENANT_ID)).resolves.toBe(5)
  })

  it('настройки тенанта есть → читает pickupSlaBufferMinutes, не дефолт', async () => {
    const repo: TenantSettingsRepositoryPort = {
      findByTenantId: vi.fn().mockResolvedValue({ pickupSlaBufferMinutes: 3 }),
      save: vi.fn(),
    }
    const adapter = new TenancyFacadeAdapter(repo, stubDrizzleDb())
    await expect(adapter.getPickupSlaBufferMinutes(TENANT_ID)).resolves.toBe(3)
  })
})
```

### 3.4 Моки порта — одна новая строка в каждом месте

Везде одинаково: вставить `getPickupSlaBufferMinutes: vi.fn(),` сразу после строки с
`getPickupSlaMinutes`, с тем же отступом. Отступы в блоках ниже — ровно как в файлах.
Пути пунктов 1–8 — внутри `apps/api/src/modules/orders/`.

#### Пункт 1. `application/checkout/calculate-order-cost.service.spec.ts`
НАЙДИ:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```
ЗАМЕНИ НА:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPickupSlaBufferMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```

#### Пункт 2. `application/checkout/checkout.use-case.spec.ts`
НАЙДИ:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```
ЗАМЕНИ НА:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPickupSlaBufferMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```

#### Пункт 3. `application/pharmacy-terminal/accept-order.use-case.spec.ts`
НАЙДИ:
```ts
    getPickupSlaMinutes,
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```
ЗАМЕНИ НА:
```ts
    getPickupSlaMinutes,
    getPickupSlaBufferMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```

#### Пункт 4. `application/pharmacy-terminal/propose-partial-fulfillment.use-case.spec.ts`, первое место
НАЙДИ:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: getTimeoutMinutes,
```
ЗАМЕНИ НА:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPickupSlaBufferMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: getTimeoutMinutes,
```

#### Пункт 5. Тот же файл, второе место (отступ 6 пробелов)
НАЙДИ:
```ts
      getPickupSlaMinutes: vi.fn(),
      getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn().mockResolvedValue(TIMEOUT_MINUTES),
```
ЗАМЕНИ НА:
```ts
      getPickupSlaMinutes: vi.fn(),
      getPickupSlaBufferMinutes: vi.fn(),
      getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn().mockResolvedValue(TIMEOUT_MINUTES),
```

#### Пункт 6. `application/pharmacy-terminal/regenerate-handover-otp.use-case.spec.ts`
НАЙДИ:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```
ЗАМЕНИ НА:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPickupSlaBufferMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```

#### Пункт 7. `application/pharmacy-terminal/report-picking-sla-breach.use-case.spec.ts`
НАЙДИ:
```ts
    getPickupSlaMinutes,
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```
ЗАМЕНИ НА:
```ts
    getPickupSlaMinutes,
    getPickupSlaBufferMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```

#### Пункт 8a. `application/policies/cod-policy.service.spec.ts`
НАЙДИ:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```
ЗАМЕНИ НА:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPickupSlaBufferMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```

#### Пункт 8b. `application/policies/payment-method-enabled-policy.service.spec.ts`
НАЙДИ:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```
ЗАМЕНИ НА:
```ts
    getPickupSlaMinutes: vi.fn(),
    getPickupSlaBufferMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
```

#### Пункт 9. `apps/api/test/integration/orders/__tests__/test-app.ts` (полный путь от корня)
НАЙДИ:
```ts
          getPickupSlaMinutes: real.getPickupSlaMinutes.bind(real),
```
ЗАМЕНИ НА:
```ts
          getPickupSlaMinutes: real.getPickupSlaMinutes.bind(real),
          getPickupSlaBufferMinutes: real.getPickupSlaBufferMinutes.bind(real),
```

## 4. План — строго по порядку

Шаг 1. Порт — раздел 3.1.
Шаг 2. Адаптер — раздел 3.2, обе правки.
Шаг 3. Спек адаптера — раздел 3.3.
Шаг 4. Моки — раздел 3.4, пункты 1–9 по порядку (8a и 8b — два файла). После каждого пункта отметь его в `todo_write`.
Шаг 5. Проверь, что моков без новой строки не осталось: `grep` по `apps/api` с шаблоном
`getPartialFulfillmentConfirmationTimeoutMinutes` — рядом с каждым найденным моком (кроме самого
порта и адаптера) должна быть строка `getPickupSlaBufferMinutes`.
Шаг 6. Гейт. Нужен `GATE: PASS`.
Шаг 7. Сдача — раздел 8.

## 5. Тесты — что именно должно быть проверено

Каждый критерий ниже проверяется механически: гейт читает `reports/qwen3/tasks/DTJ-307b.require.txt`
и ищет в файлах спеков соответствующий текст. Пропущенный критерий — красный гейт и нет коммита.

`tenancy-facade.adapter.spec.ts` — два новых `it` из раздела 3.3: дефолт 5 при отсутствии настроек;
значение из настроек (3), а не дефолт.
Остальные спеки менять по смыслу нельзя — только добавить строку мока. Все существующие тесты
должны остаться зелёными.

## 6. Запреты — нарушение = работа не принята

- Не комментируй и не удаляй существующий код, чтобы прошла проверка. Не заменяй `throw` на `return`.
- Не пиши `it.skip`, `@ts-ignore`, `@ts-expect-error`, `as any`. `eslint-disable` — только
  дословная копия уже существующей строки из образца с причиной после `--`.
- Не создавай новые папки, npm-пакеты, README и файлы-отчёты. Не используй express,
  `@nestjs/swagger`, jest.
- `import type` — только для того, что используется исключительно как тип. Класс, декоратор,
  функция, DI-токен → обычный `import`.
- Каждый параметр конструктора Nest-класса — с `@Inject(ТОКЕН или Класс)`. Это проверяет `test:arch`.
- Числа в коде (кроме тестов) — именованные константы (`const MS_PER_MINUTE = 60_000`).
  Функция ≤ 40 строк, файл ≤ 300 строк кода.
- Деньги — целые дирамы, не float. Время в domain и application — только через `Clock`,
  не `new Date()` и не `Date.now()`.
- Упал чужой, как кажется, тест — сначала проверь, не сломало ли его твоё изменение (порт, тип,
  конструктор). Писать «не связано с моими изменениями» можно только после этой проверки.

## 7. СТОП — прекрати работу и сдай отчёт со статусом BLOCKED, если

1. `git status --short` в начале работы не пустой.
2. `grep` не находит символ, который ты собираешься импортировать или вызвать.
3. Нужно изменить файл, которого нет в разделе 0.
4. Гейт падает с одной и той же ошибкой два раза подряд после твоих исправлений.
5. `edit` дважды ответил «file changed since it was read» — файл правит кто-то ещё.
6. Задание противоречит коду: метода, поля или файла нет там, где сказано.
7. В выводе гейта есть «ЭТО НЕ ОШИБКА КОДА: песочница dsh…» — это среда, а не твой код. Код не трогай.

BLOCKED с точной причиной — нормальный результат. Выдуманное DONE — провал.

## 8. Сдача

1. Сдача — одна команда: тот же гейт, что в разделе 1, но с `-Commit`:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Allowed 'apps/api/src/modules/orders/application/ports/tenancy-facade.port.ts','apps/api/src/modules/orders/infrastructure/adapters/tenancy-facade.adapter*','apps/api/src/modules/orders/application/*.spec.ts','apps/api/test/integration/orders/__tests__/test-app.ts' -RequireFile reports/qwen3/tasks/DTJ-307b.require.txt -Commit "feat(orders): DTJ-307b — TenancyFacadePort.getPickupSlaBufferMinutes"
```

   В вызове `pwsh` обязательно `timeoutMs: 600000`. Гейт сам включает полный режим и коммитит
   ТОЛЬКО при полностью зелёном прогоне, только файлы из `-Allowed` и только в твою ветку.
   Красный гейт — коммита нет: чини ошибки из вывода и запускай ту же команду снова. Сколько
   понадобится раз.
2. Ты закончил тогда и только тогда, когда в выводе есть строка `КОММИТ: <хэш> <сообщение>`,
   а последняя строка — `GATE: PASS`. Нет строки `КОММИТ:` — работа не сдана, что бы тебе ни
   казалось. Не пиши отчёт, пока её нет.
3. Ответ — строго по форме, без пересказа кода:

```
СТАТУС: DONE | BLOCKED
КОММИТ:
<строка КОММИТ: из вывода гейта, дословно>
ФАЙЛЫ:
<строки со статистикой под ней>
ГЕЙТ:
<последние 15 строк вывода гейта, дословно>
КРИТЕРИИ:
<критерий из раздела 5 → файл спека : название it(...)>
ОТКЛОНЕНИЯ: <что сделано не так, как написано, и почему — или «нет»>
БЛОКЕРЫ: <или «нет»>
```

Не пиши «успешно», «всё работает», «соответствует стилю». Не называй файлы, которых не создавал,
и не приводи вывод команд, которых не запускал.

4. Отчёт написан — работа закончена. Цель не закрывай и `update_goal` не вызывай: это делает
   координатор. Дальше ничего не делай и жди.

=== КОНЕЦ ЗАДАНИЯ DTJ-307b ===
