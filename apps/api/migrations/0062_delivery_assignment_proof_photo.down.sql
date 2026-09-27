-- Down для 0062_delivery_assignment_proof_photo.sql.

ALTER TABLE delivery_assignments DROP COLUMN IF EXISTS proof_photo_url;
