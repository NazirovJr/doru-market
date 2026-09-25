/**
 * `CloseGlyph` (DTJ-406) — крестик закрытия, общий для `Modal`/`BottomSheet`/`Toast` (не
 * дублируется — AGENTS.md §12 «прежде чем создать — найди»). Декоративный SVG (`aria-hidden`),
 * текст доступности несёт `aria-label` кнопки-обёртки (`IconButton`), не сама иконка.
 */
import { type ReactElement } from 'react'

const DEFAULT_SIZE_PX = 16

export interface CloseGlyphProps {
  readonly sizePx?: number
}

export const CloseGlyph = ({ sizePx = DEFAULT_SIZE_PX }: CloseGlyphProps): ReactElement => (
  <svg aria-hidden="true" width={sizePx} height={sizePx} viewBox="0 0 16 16" fill="none">
    <path d="M2 2 14 14M14 2 2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)
