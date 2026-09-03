-- Откат 0027_orders_cash_never_escrow.sql — снимает CHECK-констрейнт D-25.
-- Данные не затрагиваются: констрейнт ничего не хранит, только запрещает сочетание.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_cash_never_escrow;
