# DoruTJ — правила работы в репозитории

> **Роль.** Выдали тикет `DTJ-*` и просят код — ты **ИСПОЛНИТЕЛЬ**. Ты не принимаешь свою работу, не меняешь
> решения `D-*`, версии пакетов, объём релиза и конфигурацию гейтов. Не согласен — [coordinator.md §6](docs/process/coordinator.md).
> Застрял — эскалируй, а не додумывай.

Фармацевтический маркетплейс Таджикистана + White-Label платформа для аптечных сетей. Монорепо pnpm + Turborepo:
NestJS 11 на Fastify, PostgreSQL + Drizzle, React 19 + Vite; Flutter-клиенты пока вне репозитория.

## Сначала прочитай

1. [`docs/status/state.md`](docs/status/state.md) — где мы сейчас и что дальше.
2. [`docs/README.md`](docs/README.md) — индекс всех документов; в `docs/history/` лежит архив, для текущей работы он не нужен.

## Команды

```bash
pnpm verify              # typecheck + lint + arch:check + test:arch + test + build — перед сдачей
pnpm typecheck | lint | arch:check | test:arch | test | build   # те же гейты по отдельности
pnpm --filter @dorutj/api test                                  # тесты одного пакета
pnpm env:check           # .env.example против Zod-схем
pnpm docs:check          # ссылки на документы, пути в коде, AGENTS.md ≤150 строк
```

Интеграционные тесты `apps/api` в `turbo run test` не входят — [`docs/guides/integration-tests.md`](docs/guides/integration-tests.md).
Порядок работы над тикетом и диагностика гейтов — [`docs/guides/developer-handbook.md`](docs/guides/developer-handbook.md).

## Золотые правила

Истории, из-за которых правила появились, — в [`docs/process/lessons-learned.md`](docs/process/lessons-learned.md).

### 1. Не объявляй готовым непроверенное
`pnpm verify` зелёный, прогнан тобой, вывод в отчёте. Красное — стоп; упавший «чужой» тест — твой регресс. [Почему](docs/process/lessons-learned.md#r1)

### 2. Написал компонент — подключи его в том же тикете
Use case/репозиторий — в провайдеры модуля, контроллер — в `controllers`, модуль — в `AppModule.imports`, middleware — в
`AppModule.configure()`, guard — провайдер или `APP_GUARD`, npm-скрипт — запусти, ключ i18n — во все три словаря `tj/ru/en`.
Комментарий «подключит следующий тикет» вместо подключения запрещён. [Почему](docs/process/lessons-learned.md#r2)

### 3. Никогда не отключай проверку ради зелёного гейта
Не удалять и не скипать тест, не исключать код из `arch:check`, не отключать правило, не понижать `error` до `warn`,
не ослаблять порог покрытия — чини код. [Почему](docs/process/lessons-learned.md#r3)

### 4. Подавление линтера — только с обоснованием
`// eslint-disable-next-line <правило> -- <почему оно неприменимо>`. Нельзя подавлять, когда правило нашло настоящую
проблему: ORM в `domain`, `Date.now()` в домене, магическое число, функция длиннее 40 строк. [Почему](docs/process/lessons-learned.md#r4)

### 5. Соблюдай направление зависимостей
Схема и границы слоёв — в разделе «Направление зависимостей» ниже. [Почему](docs/process/lessons-learned.md#r5)

### 6. Деньги — целые дирамы, никогда float
`const totalDiram: number = itemsDiram + deliveryDiram` (1 TJS = 100 дирам); `125.50 + 15.00` запрещено. [Почему](docs/process/lessons-learned.md#r6)

### 7. Делай свой тикет и только его
Не реализуй то, что вне текущей волны; не трогай файлы вне своего `files_owned`. Чужой дефект — в отчёт, не чини молча. [Почему](docs/process/lessons-learned.md#r7)

### 8. Barrel-файлы правь только добавлением строк
`index.ts`, `*.module.ts`, `package.json`, `tsconfig.json`, `ci.yml`, `docker-compose.yml` не принадлежат никому: перечитай
файл перед правкой, не удаляй чужие строки, не переписывай целиком. [Почему](docs/process/lessons-learned.md#r8)

### 9. Ноль хардкода строк и цветов
Пользовательские строки — только через i18n (`tj/ru/en`), цвета — только CSS-переменные `--brand-*`. Смена бренда = смена конфига. [Почему](docs/process/lessons-learned.md#r9)

### 10. Застрял — скажи, не додумывай
Нет требования — реализуй разумно и запиши в `assumptions`; нужен новый пакет — не ставь, верни в `needsDependency`;
зависишь от несделанного тикета — `Null*`-адаптер с `TODO(DTJ-NNN)`; гейт красный — `blockers` с текстом ошибки. [Почему](docs/process/lessons-learned.md#r10)

### 11. Не можешь запустить проверку — это блокер, а не разрешение работать вслепую
Остановись, потрать 10 минут на диагностику (`npx` вместо `pnpm exec`, путь к бинарнику, запуск из каталога пакета —
[handbook §17](docs/guides/developer-handbook.md)), не вышло — блокер в отчёте с текстом ошибки. Без гейтов работать
можно только с явного разрешения CTO и с пометкой «написано без прогона проверок». [Почему](docs/process/lessons-learned.md#r11)

### 12. Прежде чем создать — найди
Перед новым VO, утилитой или пакетом: `grep -rn "ИмяКласса" apps packages --include=*.ts | grep -v node_modules`.
VO для двух и более пакетов — `packages/domain-kernel`, только для `apps/api` — `apps/api/src/shared-kernel`; копия в обоих местах — дефект. [Почему](docs/process/lessons-learned.md#r12)

### 13. Тестовое окружение — часть кода
Тест, не запустившийся из-за отсутствующей переменной окружения или конфига, — **не пройден**, а не «пропущен».
Нужная конфигурация добавляется в коммитируемый тестовый ENV в том же тикете; секретов там нет. [Почему](docs/process/lessons-learned.md#r13)

### 14. Сводка выводится из деталей, а не пишется отдельно
Прежде чем написать «эпик закрыт», перечисли тикеты и отметь каждый; хотя бы один не отмечен — эпик не закрыт. [Почему](docs/process/lessons-learned.md#r14)

### 15. Временный маркер обязан иметь владельца и срок
`TODO`, `@AuthNotReady()`, `NullAdapter`, закомментированный блок — только с номером тикета:
`// TODO(DTJ-055): снять после реализации TenantScopeGuard`. Маркер без номера — дефект. [Почему](docs/process/lessons-learned.md#r15)

## Границы

**Всегда:** прогнать `pnpm verify` перед сдачей; подключить написанное в том же тикете; поискать существующее перед
созданием; перечитать barrel-файл перед правкой; сдать отчёт по [формату](docs/process/report-format.md); писать «сдаю на
приёмку», а не «готово».

**Спроси сначала (эскалируй в отчёте):** пакет вне baseline; изменение решений `D-*`, версий, гейтов, объёма релиза;
противоречивое требование SRS; правка файла вне `files_owned`; работа из другой волны.

**Никогда:** сдавать непроверенное; оставлять компонент неподключённым; отключать проверку, удалять или скипать падающий тест;
подавлять правило без обоснования; выдумывать `SRS-*` и несуществующие API; `float` в деньгах; `Date.now()`, `Math.random()`,
`process.env` в `domain/`; хардкодить строки и цвета; переписывать barrel-файл; ставить зависимости внутри тикета
реализации; `TODO` без тикета; коммитить мусор; продолжать работу при неработающих гейтах; создавать VO или утилиту, не
поискав существующую; писать сводку «эпик закрыт», не сверив с деталями; менять иерархию документов (полномочие CTO).

## Направление зависимостей

```
presentation ──▶ application ──▶ domain ◀── infrastructure
```

- `domain/` — ноль фреймворков, ORM, сети, `Date.now()`, `Math.random()`, `process.env`; время и id — через порты `Clock` и `IdGenerator`.
- `application/` не импортирует `infrastructure` (реализует лишь её порты); `presentation/` не лезет в `domain` в обход use case.
- Межмодульно — только через фасад `modules/<контекст>/index.ts`.
- Фронт: `app → pages → features → entities → shared`, горизонтальные импорты между фичами запрещены.

## Git и worktree

- Работай в своей ветке от базового SHA из брифа: `git checkout -b <ветка> <SHA>`; один worktree на агента.
  В служебном worktree перед git-командами проверь `git rev-parse --show-toplevel`.
- В `development` не мёржи и не пушь — это делает координатор по слову владельца.
- Автор коммита — пользователь: без `Co-Authored-By` и любых упоминаний ИИ. Сообщение по-русски: `feat(<scope>): DTJ-NNN — <что>`.
- `git stash` не использовать (стек общий на все worktree); откладывай работу WIP-коммитом.
- Как устроена волна (ветки, порты, замок, миграции, слияние) — [`docs/process/wave-protocol.md`](docs/process/wave-protocol.md).

## Иерархия документов

При конфликте выигрывает верхний. Это **единственная копия иерархии** — в остальных документах её нет, только ссылка сюда.
Менять её может только CTO.

| № | Документ | Определяет |
|---|---|---|
| 1 | [`docs/product/scope-r1.md`](docs/product/scope-r1.md) | что входит в релиз R1, что отложено |
| 2 | [`docs/architecture/decisions/`](docs/architecture/decisions/README.md) | решения `D-01..D-27` и последующие; переоткрывать нельзя |
| 3 | `AGENTS.md` (этот файл) | правила исполнителя |
| 4 | [`docs/architecture/clean-architecture.md`](docs/architecture/clean-architecture.md) | слои, пороги C1..C18 |
| 5 | [`docs/architecture/tech-baseline.md`](docs/architecture/tech-baseline.md) | версии пакетов; отклоняться нельзя |
| 6 | [`docs/product/charter.md`](docs/product/charter.md) | устав, сценарии CUJ, NFR |
| 7 | `docs/spec/*.md` | SRS, 1017 требований |
| 8 | `tickets/**/DTJ-*.md` | конкретная задача с критериями приёмки |
| 9 | [`docs/product/client-brief-original.txt`](docs/product/client-brief-original.txt) | исходное ТЗ клиента (низший приоритет) |

## Формат отчёта

Шаблон отчёта о сдаче тикета — [`docs/process/report-format.md`](docs/process/report-format.md).
