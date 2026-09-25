/**
 * `use-cursor-pagination.spec.ts` (DTJ-408, тест-план тикета).
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCursorPagination } from './use-cursor-pagination'

describe('useCursorPagination — nextCursor === null', () => {
  it('не вызывает onLoadMore, когда nextCursor === null', () => {
    const onLoadMore = vi.fn()
    const { result } = renderHook(() => useCursorPagination({ nextCursor: null, isLoading: false, onLoadMore }))

    act(() => {
      result.current.handleLoadMore()
    })

    expect(onLoadMore).not.toHaveBeenCalled()
    expect(result.current.canLoadMore).toBe(false)
  })
})

describe('useCursorPagination — nextCursor присутствует', () => {
  it('вызывает onLoadMore при наличии nextCursor', () => {
    const onLoadMore = vi.fn()
    const { result } = renderHook(() => useCursorPagination({ nextCursor: 'cursor-1', isLoading: false, onLoadMore }))

    act(() => {
      result.current.handleLoadMore()
    })

    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(result.current.canLoadMore).toBe(true)
  })

  it('не вызывает onLoadMore второй раз, пока isLoading=true (уже идёт запрос)', () => {
    const onLoadMore = vi.fn()
    const { result } = renderHook(() => useCursorPagination({ nextCursor: 'cursor-1', isLoading: true, onLoadMore }))

    act(() => {
      result.current.handleLoadMore()
      result.current.handleLoadMore()
    })

    expect(onLoadMore).not.toHaveBeenCalled()
    expect(result.current.canLoadMore).toBe(false)
  })

  it('защищает от двойного параллельного запроса при быстром повторном вызове до обновления isLoading', () => {
    const onLoadMore = vi.fn()
    const { result } = renderHook(() => useCursorPagination({ nextCursor: 'cursor-1', isLoading: false, onLoadMore }))

    act(() => {
      // Оба вызова происходят в одном синхронном кадре — потребитель ещё не успел перерисовать
      // компонент с isLoading=true (имитация быстрого повторного скролла).
      result.current.handleLoadMore()
      result.current.handleLoadMore()
    })

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('разрешает следующий вызов после того, как потребитель сбросил isLoading в false', () => {
    const onLoadMore = vi.fn()
    const { result, rerender } = renderHook(
      ({ isLoading }: { isLoading: boolean }) => useCursorPagination({ nextCursor: 'cursor-1', isLoading, onLoadMore }),
      { initialProps: { isLoading: false } },
    )

    act(() => {
      result.current.handleLoadMore()
    })
    expect(onLoadMore).toHaveBeenCalledTimes(1)

    rerender({ isLoading: true })
    rerender({ isLoading: false })

    act(() => {
      result.current.handleLoadMore()
    })
    expect(onLoadMore).toHaveBeenCalledTimes(2)
  })
})
