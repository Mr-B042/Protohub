-- Track the original order amount separately from the final collected amount.
-- amount         = final figure (may be edited for partial delivery or discount)
-- original_amount = set once at creation, never overwritten by edits
ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_amount numeric;

-- Back-fill existing orders so original_amount = amount (best estimate for history)
UPDATE orders SET original_amount = amount WHERE original_amount IS NULL;
