# D-02. Escrow — программный ledger, а не банковский hold/capture
**Решение:** эскроу реализуется **как собственный ledger DoruTJ** (двойная запись), независимо от
возможностей банка. Банковский `hold/capture` используется ТОЛЬКО если провайдер объявляет
capability `supportsHoldCapture = true`; иначе — обычный платёж + отложенный payout.
Состояния ledger: `authorized → held → captured → paid_out` и ветви `refunded / partially_refunded`.
Диаграмма из `docs/product/client-brief-original.txt` §III.3 корректируется: шаг «Hold Amount» на стороне банка становится
опциональным, обязательным остаётся «средства не уходят аптеке до подтверждения вручения».
