-- Индекс на delivery_offers(delivery_assignment_id) для NOT EXISTS в claimUnassigned/findUnassignedPool (DTJ-316). Частичный по тем же статусам, что фильтрует запрос.

CREATE INDEX IF NOT EXISTS ix_delivery_offers_assignment_active
  ON delivery_offers (delivery_assignment_id)
  WHERE status IN ('pending', 'accepted');
