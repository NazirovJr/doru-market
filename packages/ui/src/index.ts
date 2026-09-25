// компоненты добавляются последующими тикетами EP-18 (заглушка манифеста волны 1, DTJ-400)
export {}

// DTJ-404 — первый набор базовых примитивов packages/ui (Button/IconButton/Input/Textarea/
// Skeleton/Badge/Chip/Card). Реэкспорт из барабанного файла components (D-27) — дальнейшие
// тикеты EP-18 (DTJ-405..411) добавляют свои компоненты только через components/index.ts,
// не трогая этот файл.
export * from './components/index'
