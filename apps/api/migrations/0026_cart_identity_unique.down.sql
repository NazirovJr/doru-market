-- Обратная миграция 0026_cart_identity_unique.
DROP INDEX IF EXISTS cart_tenant_session_uq;
DROP INDEX IF EXISTS cart_tenant_customer_uq;
