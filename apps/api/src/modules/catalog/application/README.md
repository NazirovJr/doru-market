# `modules/catalog/application`

Слой **application** модуля `catalog` (EP-04, DTJ-090).

Содержит:
- Use cases: `GetMedicineDetailUseCase`, `GetCategoryTreeUseCase`,
  `FindAnalogsUseCase`, `PublishMedicineUseCase`, `ProposeControlCategoryUseCase`,
  `ResolveMedicineByCompositeUseCase` (DTJ-094, 095, 096, 097, 101).
- Сервис-оркестраторы: `DosageFormNormalizerService` (DTJ-097).
- Публичный фасад: `CatalogFacade` (DTJ-096).
- Порты: `CatalogRepository`, `AnalogOfferLookupPort`, `AnalogCandidatesRepository`.

**Правило зависимостей (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1, §3):**
- Зависит ТОЛЬКО от `domain/` и собственных портов (`application/ports/*`).
- НЕ импортирует `infrastructure/` (т.е. никакого Drizzle/БД/pg в этом слое).
- НЕ импортирует `presentation/` (контроллеры/DTO).
- Use case — один класс, один публичный метод `execute()`.
- Use case не знает про HTTP: ни `Request`, ни `Response`, ни заголовков.

Авторизация политик: гард в presentation проверяет роль и передаёт флаги (`bypassVisibilityCheck`)
в use case. Сам use case НЕ проверяет роль — это политика на границе, не бизнес-правило
(`02-CLEAN-ARCHITECTURE-AND-CODE.md` §3.4).
