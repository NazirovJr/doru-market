// компоненты добавляются последующими тикетами EP-18 (заглушка манифеста волны 1, DTJ-400)
export {}

// DTJ-404 — первый набор базовых примитивов packages/ui (Button/IconButton/Input/Textarea/
// Skeleton/Badge/Chip/Card). Реэкспорт из барабанного файла components (D-27) — дальнейшие
// тикеты EP-18 (DTJ-405..411) добавляют свои компоненты только через components/index.ts,
// не трогая этот файл.
export * from './components/index'

// DTJ-406 — хуки вне components/ (не привязаны к одному компоненту, SRS-UX-025/026): статус
// сети/WS-соединения и UI-уровневый circuit breaker, потребляются конкретными фичами apps/*.
export type { ConnectionMode, ConnectionStatus } from './hooks/use-connection-status'
export { useConnectionStatus } from './hooks/use-connection-status'
export type { UiCircuitBreakerState, UseUiCircuitBreakerOptions } from './hooks/use-ui-circuit-breaker'
export { DEFAULT_COOLDOWN_MS, DEFAULT_FAILURE_THRESHOLD, useUiCircuitBreaker } from './hooks/use-ui-circuit-breaker'
