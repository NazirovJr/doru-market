import type { MouseEvent } from 'react'

/**
 * Общая логика «клик вне контента закрывает оверлей» для `Modal`/`BottomSheet` (DTJ-406 п.2) —
 * вынесена в отдельный файл, чтобы не дублировать один и тот же обработчик в двух компонентах
 * (`AGENTS.md` §12 «прежде чем создать — найди»). Закрывает ТОЛЬКО если клик начался и закончился
 * непосредственно на элементе-подложке (`event.target === event.currentTarget`) — клик, начавшийся
 * внутри контента и отпущенный за его пределами (характерно для выделения текста мышью), не
 * закрывает оверлей.
 */
export function createOverlayMouseDownHandler(
  onClose: () => void,
): (event: MouseEvent<HTMLDivElement>) => void {
  return (event) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }
}
