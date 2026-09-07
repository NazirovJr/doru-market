import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCursorPagination } from './use-cursor-pagination.js'

describe('useCursorPagination — вызов onLoadMore только при наличии курсора', () => {
  it('nextCursor === null → loadMore ничего не делает, onLoadMore не вызывается', () => {
    const onLoadMore = vi.fn()
    const { result } = renderHook(() => useCursorPagination({ nextCursor: null, onLoadMore }))

    expect(result.current.hasMore).toBe(false)

    act(() => {
      result.current.loadMore()
    })

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('nextCursor !== null → loadMore вызывает onLoadMore с этим курсором', () => {
    const onLoadMore = vi.fn()
    const { result } = renderHook(() => useCursorPagination({ nextCursor: 'cursor-1', onLoadMore }))

    expect(result.current.hasMore).toBe(true)

    act(() => {
      result.current.loadMore()
    })

    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(onLoadMore).toHaveBeenCalledWith('cursor-1')
  })
})

describe('useCursorPagination — защита от двойной параллельной загрузки', () => {
  it('повторный loadMore, пока предыдущий onLoadMore ещё не разрешился, не триггерит второй вызов', async () => {
    let resolvePending: (() => void) | undefined
    const onLoadMore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePending = resolve
        }),
    )
    const { result } = renderHook(() => useCursorPagination({ nextCursor: 'cursor-1', onLoadMore }))

    act(() => {
      result.current.loadMore()
    })
    expect(result.current.isLoadingMore).toBe(true)

    // Быстрый повторный вызов (двойной скролл/клик) — второй параллельный запрос не уходит.
    act(() => {
      result.current.loadMore()
      result.current.loadMore()
    })

    expect(onLoadMore).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolvePending?.()
      await Promise.resolve()
    })

    expect(result.current.isLoadingMore).toBe(false)
  })

  it('после завершения загрузки следующий loadMore снова вызывает onLoadMore', async () => {
    const onLoadMore = vi.fn(() => Promise.resolve())
    const { result } = renderHook(() => useCursorPagination({ nextCursor: 'cursor-1', onLoadMore }))

    await act(async () => {
      result.current.loadMore()
      await Promise.resolve()
    })
    expect(onLoadMore).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.loadMore()
      await Promise.resolve()
    })
    expect(onLoadMore).toHaveBeenCalledTimes(2)
  })
})
