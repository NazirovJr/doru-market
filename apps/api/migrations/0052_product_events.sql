-- product_events (DTJ-378, EP-17, docs/spec/27-module-admin-moderation-onboarding.md §10.1, SRS-ADM-067/068).
-- DDL — дословная транскрипция источника (тикет DTJ-378 «Что сделать» п.1).

CREATE TABLE product_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL допустим для гостя (session_id — ключ)
    session_id VARCHAR(128) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'search_performed'|'analog_shown'|'analog_clicked'|'added_to_cart'|'order_placed'|...
    medicine_id UUID REFERENCES medicines(id) ON DELETE SET NULL,
    pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    savings_diram BIGINT, -- снэпшот экономии на момент события (analog_shown/added_to_cart)
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE product_events IS
    'SRS-ADM-067/068/069. Append-only, subscriber-only (analytics read-side, не влияет на доменные '
    'инварианты). Источник воронки showed->clicked->cart->order и метрики "экономия сомони" — прямой '
    'вход для kill-критериев 1/2 (04-SCOPE-DECISION §7). НЕ путать с outbox: outbox — межмодульный '
    'транспорт доменных событий, product_events — чисто аналитическая телеметрия, включает события '
    'без доменного значения (search_performed).';
CREATE INDEX idx_product_events_tenant_type_time ON product_events (tenant_id, event_type, occurred_at);
CREATE INDEX idx_product_events_session ON product_events (session_id, occurred_at);
