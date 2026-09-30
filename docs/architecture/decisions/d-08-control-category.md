# D-08. Отсутствует `control_category` (нарушение закона РТ)
**Решение:** в `medicines` добавляется
`control_category ENUM('none','prescription_only','potent','psychotropic','narcotic')`.
Для `psychotropic` и `narcotic` — **жёсткий запрет дистанционной продажи на уровне домена**
(инвариант сущности `Medicine`/`Order`), а не только скрытие в UI. Дефолт при импорте — `none`,
новые позиции с признаками контроля попадают в модерацию.
