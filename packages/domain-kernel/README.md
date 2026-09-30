# @dorutj/domain-kernel

Общие Value Objects домена, нужные двум и более пакетам: `Dosage`, `DosageUnit`, `DosageForm`, `Barcode` и `Result`
(`ok`/`err`). Чистый пакет — ноль рантайм-зависимостей. VO, нужный только `apps/api`, живёт в `apps/api/src/shared-kernel`;
копия одного VO в обоих местах — дефект ([`AGENTS.md`](../../AGENTS.md), правило 12).

```bash
pnpm --filter @dorutj/domain-kernel test
pnpm --filter @dorutj/domain-kernel build   # потребители видят dist
```

Ядро подбора аналогов (эквивалентность дозировок) держится на тестах этого пакета — их нельзя ослаблять.
