/**
 * Unit-тест `DosageFormNormalizer` (DTJ-097, EP-04). Проверяет ТОЛЬКО
 * TS-функцию; SQL-зеркало проверяется отдельным parity-тестом
 * `dosage-form-normalizer.parity.spec.ts` (тест-план DTJ-097).
 *
 * Покрытие (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §6, `application/` ≥85%):
 *   - все 9 значений `DosageFormClass` (включая `other` как default);
 *   - нераспознанный ввод → `other`;
 *   - `null` / пустая строка / пробелы → `other`;
 *   - чувствительность к регистру и пробелам по краям.
 */
import { describe, expect, it } from 'vitest'
import { DosageFormClass } from '../../domain/medicine.enums.js'
import {
  catalogNormalizeDosageFormClass,
  DosageFormNormalizerService,
  listDosageFormAliases,
} from './dosage-form-normalizer.service.js'

describe('catalogNormalizeDosageFormClass (DTJ-097)', () => {
  describe('known aliases', () => {
    it.each<readonly [string, DosageFormClass]>([
      // tablet
      ['таблетки', DosageFormClass.tablet],
      ['таблетка', DosageFormClass.tablet],
      ['табл.', DosageFormClass.tablet],
      ['таб', DosageFormClass.tablet],
      ['tabs', DosageFormClass.tablet],
      ['tablets', DosageFormClass.tablet],
      ['tablet', DosageFormClass.tablet],
      ['pill', DosageFormClass.tablet],
      ['pills', DosageFormClass.tablet],
      // capsule
      ['капсулы', DosageFormClass.capsule],
      ['капсула', DosageFormClass.capsule],
      ['капс.', DosageFormClass.capsule],
      ['caps', DosageFormClass.capsule],
      ['capsules', DosageFormClass.capsule],
      ['capsule', DosageFormClass.capsule],
      // syrup
      ['сироп', DosageFormClass.syrup],
      ['sir.', DosageFormClass.syrup],
      ['syrup', DosageFormClass.syrup],
      ['sirup', DosageFormClass.syrup],
      ['syrups', DosageFormClass.syrup],
      // injection
      ['ампулы', DosageFormClass.injection],
      ['ампула', DosageFormClass.injection],
      ['инъекция', DosageFormClass.injection],
      ['инъекции', DosageFormClass.injection],
      ['раствор', DosageFormClass.injection],
      ['injection', DosageFormClass.injection],
      ['inj', DosageFormClass.injection],
      ['ampoules', DosageFormClass.injection],
      ['ampoule', DosageFormClass.injection],
      ['solution', DosageFormClass.injection],
      // ointment
      ['мазь', DosageFormClass.ointment],
      ['ointment', DosageFormClass.ointment],
      ['cream', DosageFormClass.ointment],
      ['unguentum', DosageFormClass.ointment],
      // drops
      ['капли', DosageFormClass.drops],
      ['drops', DosageFormClass.drops],
      // inhaler
      ['ингалятор', DosageFormClass.inhaler],
      ['ингаляторы', DosageFormClass.inhaler],
      ['inhaler', DosageFormClass.inhaler],
      ['inhalers', DosageFormClass.inhaler],
      ['inhalation', DosageFormClass.inhaler],
      // suppository
      ['свечи', DosageFormClass.suppository],
      ['суппозитории', DosageFormClass.suppository],
      ['суппозиторий', DosageFormClass.suppository],
      ['suppository', DosageFormClass.suppository],
      ['suppositories', DosageFormClass.suppository],
    ])('maps %s → %s', (input, expected) => {
      expect(catalogNormalizeDosageFormClass(input)).toBe(expected)
    })
  })

  describe('case- and whitespace-insensitive', () => {
    it.each<readonly [string, DosageFormClass]>([
      ['TABLET', DosageFormClass.tablet],
      ['Tablet', DosageFormClass.tablet],
      ['  таблетки  ', DosageFormClass.tablet],
      ['\tКапсулы\n', DosageFormClass.capsule],
      ['SYRUP', DosageFormClass.syrup],
    ])('normalizes %j → %s', (input, expected) => {
      expect(catalogNormalizeDosageFormClass(input)).toBe(expected)
    })
  })

  describe('default to DosageFormClass.other', () => {
    it.each<readonly [string, DosageFormClass]>([
      ['', DosageFormClass.other],
      ['   ', DosageFormClass.other],
      ['unknown-form', DosageFormClass.other],
      ['непонятная форма', DosageFormClass.other],
      ['gel', DosageFormClass.other],
      ['порошок', DosageFormClass.other],
    ])('returns other for %j', (input, expected) => {
      expect(catalogNormalizeDosageFormClass(input)).toBe(expected)
    })

    it('returns other for null', () => {
      expect(catalogNormalizeDosageFormClass(null)).toBe(DosageFormClass.other)
    })
  })

  describe('DosageFormNormalizerService (NestJS-провайдер)', () => {
    it('delegates to catalogNormalizeDosageFormClass', () => {
      const service = new DosageFormNormalizerService()
      expect(service.normalize('таблетки')).toBe(DosageFormClass.tablet)
      expect(service.normalize('unknown')).toBe(DosageFormClass.other)
      expect(service.normalize(null)).toBe(DosageFormClass.other)
    })
  })

  describe('listDosageFormAliases (export для parity-теста)', () => {
    it('exposes 8 классов (без `other`)', () => {
      const aliases = listDosageFormAliases()
      expect(aliases.size).toBe(8)
      expect(aliases.has(DosageFormClass.other)).toBe(false)
    })

    it('содержит минимум один алиас на каждый известный класс', () => {
      const aliases = listDosageFormAliases()
      const requiredClasses: readonly DosageFormClass[] = [
        DosageFormClass.tablet,
        DosageFormClass.capsule,
        DosageFormClass.syrup,
        DosageFormClass.injection,
        DosageFormClass.ointment,
        DosageFormClass.drops,
        DosageFormClass.inhaler,
        DosageFormClass.suppository,
      ]
      for (const cls of requiredClasses) {
        expect(aliases.get(cls)?.length ?? 0).toBeGreaterThan(0)
      }
    })
  })
})