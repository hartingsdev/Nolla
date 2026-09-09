-- Renaming a participant, with a trail of what they were called before (FR-1.12).
--
-- The name a placeholder was given by whoever created it is a guess: "Max" for
-- someone who turns out to spell it differently, or — for the trip's creator —
-- the local part of their sign-in address. Both the person themselves and a trip
-- admin can correct it, and the ledger is unaffected either way: shares point at
-- participant ids, never at names.
CREATE TABLE participant_names (
  id             bigserial PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  trip_id        uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  display_name   text NOT NULL,                       -- the name BEFORE the change, as entry_history does
  changed_by     uuid REFERENCES users(id),
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX participant_names_participant_idx ON participant_names(participant_id, at);
