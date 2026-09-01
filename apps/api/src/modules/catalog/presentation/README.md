# `modules/catalog/presentation`

Слой **presentation** модуля `catalog` (EP-04, DTJ-090).

Содержит:
- Контроллеры: `MedicinesController` (DTJ-095), `CategoriesController` (DTJ-094),
  `AnalogsController` (DTJ-102).
- DTO: `medicine-detail.dto.ts`, `category.dto.ts`, `analog-result.dto.ts`.
- Validation pipes (Zod → DTO).
- Guards для авторизации (`bypassVisibilityCheck` для `super_admin`, DTJ-095).

**Правило зависимостей (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1):**
- Зависит ТОЛЬКО от `application/` (use case + фасад).
- НЕ импортирует `domain/` напрямую (контроллер не знает про доменные инварианты).
- DTO↔domain маппинг — здесь, не в use case (`02` §3.2).
- Маппинг доменная ошибка → HTTP-код — здесь (SRS-CAT-006: 404 для `narcotic`).
