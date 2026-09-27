-- Фото-доказательство вручения (DTJ-317) — deliverRequestSchema.proofPhotoUrl раньше принимался и молча отбрасывался.

ALTER TABLE delivery_assignments ADD COLUMN IF NOT EXISTS proof_photo_url TEXT;
