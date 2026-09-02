/**
 * Тест `ZodValidationPipe`: валидный вход проходит без изменений формы,
 * невалидный — единый формат ошибки `VALIDATION_ERROR` с деталями по полям
 * (DTJ-018 §2.1), плюс поведение на пустом и на нестроковом (число/массив) входе.
 */
import { BadRequestException } from '@nestjs/common'
import { ErrorCode } from '@dorutj/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ZodValidationPipe } from './zod-validation.pipe.js'

describe('ZodValidationPipe (DTJ-018 §2.1)', () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
  })

  it('1. валидный вход → возвращает распарсенные данные как есть', () => {
    const pipe = new ZodValidationPipe(schema)
    const result = pipe.transform({ name: 'Иван', age: 30 })
    expect(result).toEqual({ name: 'Иван', age: 30 })
  })

  it('2. невалидный вход (пустая строка + отрицательный возраст) → BadRequestException с VALIDATION_ERROR и деталями по обоим полям', () => {
    const pipe = new ZodValidationPipe(schema)
    let caught: unknown
    try {
      pipe.transform({ name: '', age: -5 })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    const body = (caught as BadRequestException).getResponse() as {
      error: { code: string; message: string; details: { issues: { path: string; message: string }[] } }
    }
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    expect(body.error.message).toBe('Validation failed')
    const paths = body.error.details.issues.map((issue) => issue.path)
    expect(paths).toContain('name')
    expect(paths).toContain('age')
  })

  it('3. пустой объект (нет обязательных полей) → VALIDATION_ERROR с issues по каждому отсутствующему полю', () => {
    const pipe = new ZodValidationPipe(schema)
    let caught: unknown
    try {
      pipe.transform({})
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    const body = (caught as BadRequestException).getResponse() as {
      error: { details: { issues: { path: string }[] } }
    }
    expect(body.error.details.issues.length).toBeGreaterThanOrEqual(2)
  })

  it('4. нестроковый/нестандартный вход (число вместо объекта) → BadRequestException с VALIDATION_ERROR', () => {
    const pipe = new ZodValidationPipe(schema)
    let caught: unknown
    try {
      pipe.transform(42)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    const body = (caught as BadRequestException).getResponse() as { error: { code: string } }
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR)
  })

  it('5. нестроковый вход (массив вместо объекта) → тоже VALIDATION_ERROR, схема не падает с необработанным исключением', () => {
    const pipe = new ZodValidationPipe(schema)
    expect(() => pipe.transform([1, 2, 3])).toThrow(BadRequestException)
  })

  it('6. null → VALIDATION_ERROR (а не TypeError на доступе к полям)', () => {
    const pipe = new ZodValidationPipe(schema)
    let caught: unknown
    try {
      pipe.transform(null)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    const body = (caught as BadRequestException).getResponse() as { error: { code: string } }
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR)
  })
})
