# DoruTJ — Технологический baseline (зафиксированные версии)

> Владелец: Architect. Статус: **BASELINE v1.0**.
> Версии проверены через `npm view` на 2026-08-27 и подобраны по критерию **взаимной совместимости**,
> а не «самое свежее». Отклонение от baseline допускается только если `pnpm install` не резолвится —
> тогда фиксируется в ADR.

## Принцип выбора версий

Сознательно НЕ берём абсолютно последние мажоры там, где экосистема за ними не успела:

| Пакет | Последняя | Берём | Почему не последнюю |
|---|---|---|---|
| typescript | 7.0.2 | **^5.9.3** | TS 7 — нативный порт; `emitDecoratorMetadata`/декораторы NestJS и `typescript-eslint` (peer `<6.1.0`) ещё не поддержаны. Риск неразрешимый на старте. |
| eslint | 10.9.1 | **^9.39.5** | `typescript-eslint@8` формально допускает 10, но плагины экосистемы протестированы на 9. |
| vite | 8.2.2 | **^7.3.6** | Vite 8 свежий; Vitest 4 и tailwind-плагин стабильны на 7. |
| framer-motion | 13.1.1 | **^12.43.0** | 13 — свежий мажор с breaking API. |
| react-router | 8.3.0 | **^7.18.2** | v8 — свежий мажор. v7 declarative mode покрывает все нужды. |
| ioredis | 6.0.0 | **^5** | `bullmq@6` требует `>=5`; 5.x — зрелая ветка. |

## Зафиксированный стек

### Runtime
- Node.js **>=22.12** (в среде разработки — v24.19), pnpm **>=10** (в среде — 11.23)
- PostgreSQL **16**, Redis **7**, MinIO (S3 API), Nginx
- **Flutter 3.47.1 stable / Dart 3.13.1** — проверено `flutter doctor` архитектором 2026-08-27.
  Путь установки: `C:\Users\nazir\develop\flutter\bin` (в PATH пользователя).

### Мобильные клиенты (Flutter)

| Компонент | Выбор | Примечание |
|---|---|---|
| Flutter SDK | **3.47.1 stable** | Dart 3.13.1, DevTools 2.60.0 |
| Целевая платформа | **Android** (планшет фармацевта, телефон курьера) | Основная и единственная целевая платформа фазы 1 |
| Таргет разработки до установки Android SDK | **`flutter run -d chrome`** | Позволяет вести разработку и ревью UI немедленно; тот же Dart-код |
| Состояние | `flutter_bloc` (Cubit) | Предсказуемые переходы состояний — важно для state machine заказа |
| Сеть | `dio` + перехватчики (JWT, retry, requestId) | Модели генерируются из `docs/api/openapi.json` |
| Локальное хранилище | `drift` (SQLite) или `hive` | Офлайн-очередь действий курьера/фармацевта |
| Сканер штрихкодов | `mobile_scanner` | Требует реального Android-устройства для приёмки |
| Геолокация | `geolocator` | Требует реального Android-устройства для приёмки |
| Карта | `flutter_map` (MapLibre/OSM-тайлы) | Без проприетарных SDK и ключей |

**Статус тулчейна (проверено архитектором, обновлено 27.08.2026):**

| Проверка | Статус | Комментарий |
|---|---|---|
| Flutter | ✅ | 3.47.1 stable |
| Windows Version | ✅ | Windows 11, 25H2 |
| **Android toolchain** | ✅ | **Android SDK 36.0.0 установлен.** Сборка APK и приёмка эпиков «Сканер штрихкодов» и «Геотрекинг курьера» разблокированы |
| Chrome (web target) | ✅ | Быстрая итерация по UI через `flutter run -d chrome` |
| Connected devices | ✅ | 3 доступно |
| Network resources | ✅ | — |
| **Visual Studio** | ⬜ | **НЕ требуется и не будет устанавливаться.** Нужен только для Flutter под Windows desktop, который не входит в scope (цель — Android). Этот пункт `flutter doctor` игнорируется намеренно |

> **Вывод архитектора:** тулчейн для мобильных клиентов **полностью готов**. Единственный
> оставшийся «крестик» в `flutter doctor` относится к платформе вне scope и не является дефектом.
> Реализация `apps/pharmacy_mobile` и `apps/courier_mobile` не имеет внешних блокеров —
> они входят в **Release 2** согласно `04-SCOPE-DECISION-PIVOT.md`, сразу после приёмки R1.

> **Правило для агентов:** `flutter` может отсутствовать в `PATH` неинтерактивной оболочки.
> Всегда вызывать по абсолютному пути `C:\Users\nazir\develop\flutter\bin\flutter.bat`
> либо предварительно добавлять каталог в `$env:Path`.

### Корневые dev-зависимости
```
typescript          ^5.9.3
@types/node         ^24.13.3
turbo               ^2.10.12
eslint              ^9.39.5
typescript-eslint   ^8.68.0
prettier            ^3.9.6
vitest              ^4.1.11
@vitest/coverage-v8 ^4.1.11
@playwright/test    ^1.62.1
tsx                 latest stable
```

### Backend (`apps/api`, `apps/worker`)
```
@nestjs/core, @nestjs/common, @nestjs/platform-fastify, @nestjs/config, @nestjs/jwt  ^11.2.3
@nestjs/schedule, @nestjs/terminus                                                    ^11 совместимые
fastify (через platform-fastify), @fastify/helmet, @fastify/cors, @fastify/multipart, @fastify/rate-limit
reflect-metadata    ^0.2
rxjs                ^7.8
drizzle-orm         ^0.45.2
drizzle-kit         ^0.31.10
pg                  ^8.23.0
bullmq              ^6.3.0
ioredis             ^5
zod                 ^4.4.3
pino, pino-http     ^10.3.1
argon2 (или @node-rs/argon2)
nanoid / uuid
supertest (dev)
```

### Frontend (`apps/web`, `apps/pharmacy`, `apps/courier`, `apps/admin`)
```
react, react-dom          ^19.2.0
vite                      ^7.3.6
@vitejs/plugin-react       latest совместимый с vite 7
tailwindcss               ^4.3.3
@tailwindcss/vite         ^4.3.3
framer-motion             ^12.43.0
lucide-react              ^1.34.0
@tanstack/react-query     ^5.102.6
react-router              ^7.18.2
zustand                   ^5.0.15
zod                       ^4.4.3   (через packages/contracts)
```

> **Tailwind v4**: конфигурация — CSS-first (`@import "tailwindcss"; @theme { ... }`),
> плагин `@tailwindcss/vite`. Файла `tailwind.config.js` в v4 быть НЕ должно (только если нужен legacy-режим).
> Токены брендинга White-Label подаются через CSS-переменные, переопределяемые в рантайме.

### Правила
1. Все версии объявляются **в корневом** `package.json` через `pnpm.overrides` там, где нужен единый резолв
   (react, typescript, zod), чтобы исключить дубли в workspace.
2. Никаких `latest` в `dependencies` — только явные диапазоны `^x.y.z`.
3. Любой новый пакет вне этого списка требует одной строки обоснования в PR/тикете.
4. После любого изменения зависимостей обязателен успешный `pnpm install --frozen-lockfile` в CI.
