-- Transfer dispute (FR-5.3).
--
-- The recipient of a payment can flag one they do not recognise. The transfer
-- keeps counting toward the balances exactly as before: I2 (Σ balances == 0)
-- must never depend on anyone agreeing, so a dispute is a flag on the row and
-- never a change to the money. It is cleared by withdrawing it, or by deleting
-- the transfer.
ALTER TABLE entries
  ADD COLUMN disputed_at    timestamptz,
  ADD COLUMN disputed_by    uuid REFERENCES participants(id),   -- the participant who raised it
  ADD COLUMN dispute_reason text;

ALTER TABLE entries
  -- Only a transfer moves money between two people directly; nothing else is disputable.
  ADD CONSTRAINT entries_dispute_transfer_only CHECK (disputed_at IS NULL OR type = 'transfer'),
  -- The dispute columns travel together: no timestamp without an author, no
  -- reason without a dispute to explain.
  ADD CONSTRAINT entries_dispute_pair CHECK ((disputed_at IS NULL) = (disputed_by IS NULL)),
  ADD CONSTRAINT entries_dispute_reason_needs_dispute CHECK (disputed_at IS NOT NULL OR dispute_reason IS NULL),
  ADD CONSTRAINT entries_dispute_reason_len CHECK (dispute_reason IS NULL OR length(dispute_reason) <= 500);
