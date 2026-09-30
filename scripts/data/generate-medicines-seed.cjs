// scripts/generate-medicines-seed.cjs — генератор seed для EP-04 (DTJ-098)
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-magic-numbers -- CommonJS-скрипт: `require` — единственный способ подключения `node:fs`/`node:path` в .cjs. Магические числа 28/4/3 — параметры генератора (цикл по брендам и индексы форм), не доменная логика. */
const fs = require('node:fs')
const path = require('node:path')

const substs = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'apps/api/src/db/seed/data/substances.seed.json'), 'utf8')
)
const substByName = new Map(substs.map((s) => [s.innName, s.id]))

const byName = (n) => {
  const id = substByName.get(n)
  if (!id) {
    throw new Error('Unknown substance: ' + n)
  }
  return id
}

const MANUFACTURERS = [
  'Дармонд',
  'Хумофарм',
  'Фармстандарт',
  'STADA',
  'Bayer',
  'Sanofi',
  'Novartis',
  'Gedeon Richter',
  'Berlin-Chemie',
  'KRKA',
  'Teva',
  'Sandoz',
  'Actavis',
  'Lupin',
  'Dr.Reddy',
  'Cipla',
  'Aurobindo',
  'Hemofarm',
  'Polpharma',
  'Glenmark',
]

const FORMS = [
  { name: 'таблетки', cls: 'tablet' },
  { name: 'таблетки покрытые оболочкой', cls: 'tablet' },
  { name: 'капсулы', cls: 'capsule' },
  { name: 'сироп', cls: 'syrup' },
  { name: 'раствор для инъекций', cls: 'injection' },
  { name: 'мазь', cls: 'ointment' },
  { name: 'капли', cls: 'drops' },
  { name: 'суппозитории', cls: 'suppository' },
]

const bases = [
  {
    name: 'Парацетамол 500 мг',
    inn: 'Парацетамол',
    subs: [{ n: 'Парацетамол', v: 500, u: 'mg' }],
    form: 'tablet',
    strength: '500 мг',
    rx: false,
    ctl: 'none',
    cat: 'nesteroidnye-protivovospalitelnye',
  },
  {
    name: 'Ибупрофен 400 мг',
    inn: 'Ибупрофен',
    subs: [{ n: 'Ибупрофен', v: 400, u: 'mg' }],
    form: 'tablet',
    strength: '400 мг',
    rx: false,
    ctl: 'none',
    cat: 'nesteroidnye-protivovospalitelnye',
  },
  {
    name: 'Амоксициллин 500 мг',
    inn: 'Амоксициллин',
    subs: [{ n: 'Амоксициллин', v: 500, u: 'mg' }],
    form: 'capsule',
    strength: '500 мг',
    rx: true,
    ctl: 'none',
    cat: 'penicilliny',
  },
  {
    name: 'Омепразол 20 мг',
    inn: 'Омепразол',
    subs: [{ n: 'Омепразол', v: 20, u: 'mg' }],
    form: 'capsule',
    strength: '20 мг',
    rx: false,
    ctl: 'none',
    cat: 'antatsidy',
  },
  {
    name: 'Лоперамид 2 мг',
    inn: 'Лоперамид',
    subs: [{ n: 'Лоперамид', v: 2, u: 'mg' }],
    form: 'tablet',
    strength: '2 мг',
    rx: false,
    ctl: 'none',
    cat: 'protivodiareynye',
  },
  {
    name: 'Цитрамон П',
    inn: 'Ацетилсалициловая кислота + Кофеин + Парацетамол',
    subs: [
      { n: 'Ацетилсалициловая кислота', v: 240, u: 'mg' },
      { n: 'Кофеин', v: 30, u: 'mg' },
      { n: 'Парацетамол', v: 180, u: 'mg' },
    ],
    form: 'tablet',
    strength: '500 мг',
    rx: false,
    ctl: 'none',
    cat: 'antigrippoznye',
  },
  {
    name: 'Азитромицин 500 мг',
    inn: 'Азитромицин',
    subs: [{ n: 'Азитромицин', v: 500, u: 'mg' }],
    form: 'tablet',
    strength: '500 мг',
    rx: true,
    ctl: 'none',
    cat: 'makrolidy',
  },
  {
    name: 'Парацетамол сироп',
    inn: 'Парацетамол',
    subs: [{ n: 'Парацетамол', v: 120, u: 'mg' }],
    form: 'syrup',
    strength: '120 мг/5 мл',
    rx: false,
    ctl: 'none',
    cat: 'protivoprostudnye',
  },
  {
    name: 'Парацетамол 1000 мг',
    inn: 'Парацетамол',
    subs: [{ n: 'Парацетамол', v: 1000, u: 'mg' }],
    form: 'tablet',
    strength: '1000 мг',
    rx: false,
    ctl: 'none',
    cat: 'nesteroidnye-protivovospalitelnye',
  },
  {
    name: 'Витамин B12 500 мкг',
    inn: 'Витамин B12',
    subs: [{ n: 'Витамин B12', v: 500, u: 'mcg' }],
    form: 'tablet',
    strength: '500 мкг',
    rx: false,
    ctl: 'none',
    cat: 'vitaminy',
  },
  {
    name: 'Витамин B12 0.5 мг',
    inn: 'Витамин B12',
    subs: [{ n: 'Витамин B12', v: 0.5, u: 'mg' }],
    form: 'tablet',
    strength: '0.5 мг',
    rx: false,
    ctl: 'none',
    cat: 'vitaminy',
  },
]

const medicines = []
for (const base of bases) {
  for (let i = 0; i < 28; i++) {
    const mfr = MANUFACTURERS[i % MANUFACTURERS.length]
    const formVariant = FORMS[Math.floor(i / 4) % FORMS.length]
    const isCombo = base.subs.length > 1
    const form = isCombo && formVariant.cls === 'injection' ? 'tablet' : formVariant.cls
    const formName = isCombo && formVariant.cls === 'injection' ? 'таблетки' : formVariant.name
    const tradeName = i === 0 ? base.name : base.name + ' ' + mfr
    medicines.push({
      tradeName,
      innName: base.inn,
      categorySlug: base.cat,
      dosageForm: formName,
      dosageStrength: base.strength,
      dosageFormClass: form,
      manufacturerCountry: 'Россия',
      manufacturerName: mfr,
      isPrescriptionRequired: base.rx,
      controlCategory: base.ctl,
      requiresColdChain: false,
      imageUrl: null,
      descriptionTj: null,
      descriptionRu: null,
      substances: base.subs.map((s) => ({
        substanceId: byName(s.n),
        strengthValue: s.v,
        strengthUnit: s.u,
      })),
    })
  }
}

const extras = [
  {
    name: 'Кодеин 30 мг',
    inn: 'Кодеин',
    subs: [{ n: 'Кодеин', v: 30, u: 'mg' }],
    form: 'tablet',
    strength: '30 мг',
    rx: true,
    ctl: 'potent',
    cat: 'obezbolivayushchie',
  },
  {
    name: 'Морфин 10 мг/мл',
    inn: 'Морфин',
    subs: [{ n: 'Морфин', v: 10, u: 'mg' }],
    form: 'injection',
    strength: '10 мг/мл',
    rx: true,
    ctl: 'potent',
    cat: 'obezbolivayushchie',
  },
  {
    name: 'Кодеин+Парацетамол',
    inn: 'Кодеин+Парацетамол',
    subs: [
      { n: 'Кодеин', v: 8, u: 'mg' },
      { n: 'Парацетамол', v: 500, u: 'mg' },
    ],
    form: 'tablet',
    strength: '508 мг',
    rx: true,
    ctl: 'potent',
    cat: 'obezbolivayushchie',
  },
]
for (const ex of extras) {
  for (const mfr of MANUFACTURERS.slice(0, 3)) {
    medicines.push({
      tradeName: ex.name + ' ' + mfr,
      innName: ex.inn,
      categorySlug: ex.cat,
      dosageForm: ex.form === 'tablet' ? 'таблетки' : 'раствор для инъекций',
      dosageStrength: ex.strength,
      dosageFormClass: ex.form,
      manufacturerCountry: 'Россия',
      manufacturerName: mfr,
      isPrescriptionRequired: ex.rx,
      controlCategory: ex.ctl,
      requiresColdChain: false,
      imageUrl: null,
      descriptionTj: null,
      descriptionRu: null,
      substances: ex.subs.map((s) => ({
        substanceId: byName(s.n),
        strengthValue: s.v,
        strengthUnit: s.u,
      })),
    })
  }
}

fs.writeFileSync(
  path.join(__dirname, '..', 'apps/api/src/db/seed/data/medicines.seed.json'),
  JSON.stringify(medicines, null, 2)
)
console.log('Total medicines:', medicines.length)
