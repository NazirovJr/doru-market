-- Down-миграция для 0023_orders_cart.sql (DTJ-220).
-- Обратный порядок относительно зависимостей FK: favorites/cart_items/cart/order_items/orders,
-- затем enum order_status.
-- ВНИМАНИЕ: DROP TYPE упадёт, если в схеме остались колонки этого типа (см. 0002_enums.down.sql).

DROP TABLE IF EXISTS favorites;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS cart;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;

DROP TYPE IF EXISTS "order_status";
