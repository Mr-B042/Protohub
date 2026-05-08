ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_quantity integer;
UPDATE orders SET original_quantity = quantity WHERE original_quantity IS NULL;
