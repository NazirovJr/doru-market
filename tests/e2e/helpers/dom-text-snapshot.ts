// Снимок видимых текстовых узлов + alt/title/aria-label — для сравнения DOM до/после смены
// локали. Нет opt-out атрибута для произвольного текста: это замаскировало бы хардкод.
import { type Page } from '@playwright/test'

export interface CaptureVisibleTextSnapshotOptions {
  readonly ignorePattern?: RegExp
}

const DEFAULT_IGNORE_PATTERN = /^[\d][\d\s.,:/-]*$/

export async function captureVisibleTextSnapshot(
  page: Page,
  options: CaptureVisibleTextSnapshotOptions = {},
): Promise<Set<string>> {
  const ignorePattern = options.ignorePattern ?? DEFAULT_IGNORE_PATTERN
  const rawValues = await page.evaluate(collectVisibleTextAndAttributes)
  const values = rawValues.map((value) => value.trim()).filter((value) => value.length > 0 && !ignorePattern.test(value))
  return new Set(values)
}

// Выполняется в браузере (page.evaluate сериализует только тело) — без внешних ссылок.
function collectVisibleTextAndAttributes(): string[] {
  const isVisible = (element: Element): boolean => {
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false
    }
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const results: string[] = []
  const skippedTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT'])

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (parent === null || skippedTags.has(parent.tagName) || !isVisible(parent)) {
        return NodeFilter.FILTER_REJECT
      }
      return (node.textContent ?? '').trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    results.push((node.textContent ?? '').trim())
  }

  const attributeNames = ['alt', 'title', 'aria-label'] as const
  for (const element of Array.from(document.querySelectorAll('[alt],[title],[aria-label]'))) {
    if (!isVisible(element)) continue
    for (const attributeName of attributeNames) {
      const value = element.getAttribute(attributeName)?.trim()
      if (value !== undefined && value.length > 0) {
        results.push(value)
      }
    }
  }

  return results
}
