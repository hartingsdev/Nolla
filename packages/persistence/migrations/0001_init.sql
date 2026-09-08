-- Vacation Spending Tracker — initial schema. architecture.md §5.
-- Money: BIGINT minor units for anything payable; NUMERIC(20,8) for derived shares (requirements §5.1).
-- Every tenant-scoped table carries trip_id (NFR-14). No floating-point column anywhere (P6).


CREATE TYPE auth_provider AS ENUM ('apple', 'google', 'email');
CREATE TYPE trip_status   AS ENUM ('open', 'settling', 'closed');
CREATE TYPE member_role   AS ENUM ('member', 'admin');
CREATE TYPE entry_type    AS ENUM ('expense', 'transfer', 'adjustment');

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text UNIQUE,
  display_name  text,
  plan          text NOT NULL DEFAULT 'unlimited',
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE auth_identities (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider  auth_provider NOT NULL,
  subject   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX auth_identities_user_idx ON auth_identities(user_id);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE magic_links (
  token_hash bytea PRIMARY KEY,
  email      text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- tenancy
CREATE TABLE trips (
  id             uuid PRIMARY KEY,
  name           text NOT NULL,
  base_ccy       char(3) NOT NULL,
  ccy_exponent   smallint NOT NULL CHECK (ccy_exponent IN (0, 2, 3)),
  timezone       text NOT NULL DEFAULT 'Europe/Berlin',
  start_date     date,
  end_date       date,
  status         trip_status NOT NULL DEFAULT 'open',
  retention_days integer NOT NULL DEFAULT 365,              -- D11 / FR-12.4
  created_by     uuid NOT NULL REFERENCES users(id),
  seq            bigint NOT NULL DEFAULT 0,                 -- per-trip change counter, architecture.md §6.3
  meta_seq       bigint NOT NULL DEFAULT 0,                 -- seq of the last change to this row
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  trip_id  uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     member_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE participants (
  id            uuid PRIMARY KEY,
  trip_id       uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,   -- NULL = placeholder (FR-1.3) or tombstone (FR-1.9)
  joined_at     date NOT NULL,
  left_at       date,
  tombstoned_at timestamptz,
  seq           bigint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX participants_trip_user_uidx ON participants(trip_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX participants_trip_seq_idx ON participants(trip_id, seq);

CREATE TABLE invites (
  token_hash bytea PRIMARY KEY,
  trip_id    uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invites_trip_idx ON invites(trip_id);

-- ---------------------------------------------------------------- ledger
CREATE TABLE entries (
  id           uuid PRIMARY KEY,                             -- client-generated UUIDv7 (A7)
  trip_id      uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  type         entry_type NOT NULL,
  description  text NOT NULL,
  amount_minor bigint NOT NULL,
  ccy          char(3) NOT NULL,
  ccy_exponent smallint NOT NULL CHECK (ccy_exponent IN (0, 2, 3)),
  fx_rate      numeric(20,10),                               -- D4: present, unused in v0.1
  date         date NOT NULL,
  category     text,
  note         text,
  reason       text,
  split_rule   jsonb,
  version      integer NOT NULL DEFAULT 1,
  seq          bigint NOT NULL,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT entries_adjustment_reason CHECK (type <> 'adjustment' OR (reason IS NOT NULL AND length(trim(reason)) > 0)),
  CONSTRAINT entries_transfer_positive CHECK (type <> 'transfer' OR amount_minor > 0)
);
CREATE INDEX entries_trip_seq_idx ON entries(trip_id, seq);
CREATE INDEX entries_trip_date_idx ON entries(trip_id, date);

CREATE TABLE payments (
  entry_id       uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  trip_id        uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id),
  amount_minor   bigint NOT NULL,
  ord            smallint NOT NULL DEFAULT 0,               -- client order; roundAll's tie-break depends on it
  PRIMARY KEY (entry_id, participant_id)
);
CREATE INDEX payments_trip_participant_idx ON payments(trip_id, participant_id);

CREATE TABLE shares (
  entry_id          uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  trip_id           uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  participant_id    uuid NOT NULL REFERENCES participants(id),
  amount            numeric(20,8) NOT NULL,                  -- Precise (P2)
  weight            bigint,
  settled_by_entry  uuid REFERENCES entries(id) ON DELETE SET NULL,   -- FR-7.4 / P7
  ord               smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, participant_id)
);
CREATE INDEX shares_trip_participant_idx ON shares(trip_id, participant_id);

CREATE TABLE attachments (
  id          uuid PRIMARY KEY,
  entry_id    uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  trip_id     uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  blob_key    text NOT NULL,
  bytes       bigint NOT NULL,
  mime        text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),            -- FR-12.4: retention metadata from day one
  deleted_at  timestamptz
);
CREATE INDEX attachments_trip_idx ON attachments(trip_id, uploaded_at);

CREATE TABLE entry_history (
  id        bigserial PRIMARY KEY,
  entry_id  uuid NOT NULL,
  trip_id   uuid NOT NULL,
  version   integer NOT NULL,
  actor     uuid,
  at        timestamptz NOT NULL DEFAULT now(),
  snapshot  jsonb NOT NULL                                   -- the row (with children) BEFORE the change
);
CREATE INDEX entry_history_entry_idx ON entry_history(entry_id, version);

-- ---------------------------------------------------------------- invariants (FR-9.1)
-- I1: Σ payments == amount, Σ shares == amount (at Precise precision), at least one of each,
--     payments never oppose the amount's sign. Checked when the transaction commits, so an entry
--     and its children can be written in any order inside one transaction.
CREATE OR REPLACE FUNCTION check_entry_sums() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  eid  uuid;
  e    entries%ROWTYPE;
  pay  bigint;
  sh   numeric(20,8);
  npay integer;
  nsh  integer;
  bad  integer;
BEGIN
  IF TG_TABLE_NAME = 'entries' THEN
    eid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    eid := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
  END IF;
  SELECT * INTO e FROM entries WHERE id = eid;
  IF NOT FOUND THEN RETURN NULL; END IF;             -- entry hard-deleted; children cascade

  SELECT COALESCE(SUM(amount_minor), 0), COUNT(*) INTO pay, npay FROM payments WHERE entry_id = eid;
  SELECT COALESCE(SUM(amount), 0),       COUNT(*) INTO sh,  nsh  FROM shares   WHERE entry_id = eid;
  IF npay = 0 OR nsh = 0 THEN
    RAISE EXCEPTION 'I1: entry % needs at least one payment and one share', eid USING ERRCODE = 'check_violation';
  END IF;
  IF pay <> e.amount_minor THEN
    RAISE EXCEPTION 'I1: entry % payments sum % != amount %', eid, pay, e.amount_minor USING ERRCODE = 'check_violation';
  END IF;
  IF sh <> (e.amount_minor::numeric / power(10::numeric, e.ccy_exponent)) THEN
    RAISE EXCEPTION 'I1: entry % shares sum % != amount %', eid, sh, e.amount_minor USING ERRCODE = 'check_violation';
  END IF;
  SELECT COUNT(*) INTO bad FROM payments WHERE entry_id = eid AND amount_minor * sign(e.amount_minor) < 0;
  IF bad > 0 THEN
    RAISE EXCEPTION 'I1: entry % has payments opposing the sign of the amount', eid USING ERRCODE = 'check_violation';
  END IF;
  IF e.type = 'transfer' AND (npay <> 1 OR nsh <> 1) THEN
    RAISE EXCEPTION 'I1: transfer % must have exactly one sender and one recipient', eid USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER entries_i1  AFTER INSERT OR UPDATE OR DELETE ON entries  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_sums();
CREATE CONSTRAINT TRIGGER payments_i1 AFTER INSERT OR UPDATE OR DELETE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_sums();
CREATE CONSTRAINT TRIGGER shares_i1   AFTER INSERT OR UPDATE OR DELETE ON shares   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_sums();

-- I5: a closed trip accepts no ledger writes. Belt and braces under the use-case check.
CREATE OR REPLACE FUNCTION reject_closed_trip_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid uuid; st trip_status;
BEGIN
  tid := CASE WHEN TG_OP = 'DELETE' THEN OLD.trip_id ELSE NEW.trip_id END;
  SELECT status INTO st FROM trips WHERE id = tid;
  IF st = 'closed' THEN
    RAISE EXCEPTION 'I5: trip % is closed', tid USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER entries_closed  BEFORE INSERT OR UPDATE OR DELETE ON entries  FOR EACH ROW EXECUTE FUNCTION reject_closed_trip_write();
CREATE TRIGGER payments_closed BEFORE INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION reject_closed_trip_write();
CREATE TRIGGER shares_closed   BEFORE INSERT OR UPDATE OR DELETE ON shares   FOR EACH ROW EXECUTE FUNCTION reject_closed_trip_write();
