import { StrictMode, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { AppProviders } from '@/app/providers'
import { router } from '@/app/router'
import '@/app/styles.css'

/**
 * `App.tsx` (DTJ-166) — корневой компонент кабинета аптеки. `files_owned` DTJ-166 не включает
 * отдельный `main.tsx` (в отличие от `apps/web`/`apps/admin`) — этот файл совмещает роль
 * корневого компонента и точки монтирования (`index.html` подключает его напрямую как
 * `<script type="module" src="/src/app/App.tsx">`).
 *
 * Без покрытия тестами по design: код монтирования (`createRoot(...).render(...)`) выполняется
 * как побочный эффект на этапе импорта модуля — тот же паттерн, что `apps/web/src/app/main.tsx`
 * (там тоже нет `main.spec.tsx`); юнит-тест такого файла требовал бы мокать весь DOM/роутер ради
 * проверки, что `createRoot` был вызван — не даёт сигнала, которого не даёт уже `pnpm --filter
 * pharmacy build` + ручная проверка в браузере (см. отчёт DTJ-166).
 */
const App = (): ReactElement => (
  <AppProviders>
    <RouterProvider router={router} />
  </AppProviders>
)

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Корневой DOM-узел #root не найден — проверь apps/pharmacy/index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
