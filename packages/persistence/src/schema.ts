/**
 * Drizzle mirror of migrations/*.sql. The SQL is the source of truth; a test
 * asserts every column here exists in the migrated database with the same
 * name, so the two cannot drift silently.
 */
import {
  bigint, bigserial, boolean, char, date, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid, customType,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({ dataType: () => 'bytea' });

export const authProvider = pgEnum('auth_provider', ['apple', 'google', 'email']);
export const tripStatus = pgEnum('trip_status', ['open', 'settling', 'closed']);
export const memberRole = pgEnum('member_role', ['member', 'admin']);
export const entryType = pgEnum('entry_type', ['expense', 'transfer', 'adjustment']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').unique(),
  displayName: text('display_name'),
  plan: text('plan').notNull().default('unlimited'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const authIdentities = pgTable('auth_identities', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: authProvider('provider').notNull(),
  subject: text('subject').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.provider, t.subject] }), index('auth_identities_user_idx').on(t.userId)]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: bytea('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const magicLinks = pgTable('magic_links', {
  tokenHash: bytea('token_hash').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  baseCcy: char('base_ccy', { length: 3 }).notNull(),
  ccyExponent: smallint('ccy_exponent').notNull(),
  timezone: text('timezone').notNull().default('Europe/Berlin'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  status: tripStatus('status').notNull().default('open'),
  retentionDays: integer('retention_days').notNull().default(365),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  seq: bigint('seq', { mode: 'bigint' }).notNull().default(0n),
  metaSeq: bigint('meta_seq', { mode: 'bigint' }).notNull().default(0n),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable('memberships', {
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: memberRole('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tripId, t.userId] }), index('memberships_user_idx').on(t.userId)]);

export const participants = pgTable('participants', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  joinedAt: date('joined_at').notNull(),
  leftAt: date('left_at'),
  tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
  seq: bigint('seq', { mode: 'bigint' }).notNull().default(0n),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('participants_trip_user_uidx').on(t.tripId, t.userId), index('participants_trip_seq_idx').on(t.tripId, t.seq)]);

export const invites = pgTable('invites', {
  tokenHash: bytea('token_hash').primaryKey(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('invites_trip_idx').on(t.tripId)]);

export const entries = pgTable('entries', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  type: entryType('type').notNull(),
  description: text('description').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  ccy: char('ccy', { length: 3 }).notNull(),
  ccyExponent: smallint('ccy_exponent').notNull(),
  fxRate: numeric('fx_rate', { precision: 20, scale: 10 }),
  date: date('date').notNull(),
  category: text('category'),
  note: text('note'),
  reason: text('reason'),
  splitRule: jsonb('split_rule'),
  version: integer('version').notNull().default(1),
  seq: bigint('seq', { mode: 'bigint' }).notNull(),
  disputedAt: timestamp('disputed_at', { withTimezone: true }),
  disputedBy: uuid('disputed_by').references(() => participants.id),
  disputeReason: text('dispute_reason'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('entries_trip_seq_idx').on(t.tripId, t.seq), index('entries_trip_date_idx').on(t.tripId, t.date)]);

export const payments = pgTable('payments', {
  entryId: uuid('entry_id').notNull().references(() => entries.id, { onDelete: 'cascade' }),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  participantId: uuid('participant_id').notNull().references(() => participants.id),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  ord: smallint('ord').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.entryId, t.participantId] }), index('payments_trip_participant_idx').on(t.tripId, t.participantId)]);

export const shares = pgTable('shares', {
  entryId: uuid('entry_id').notNull().references(() => entries.id, { onDelete: 'cascade' }),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  participantId: uuid('participant_id').notNull().references(() => participants.id),
  amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
  weight: bigint('weight', { mode: 'bigint' }),
  settledByEntry: uuid('settled_by_entry').references(() => entries.id, { onDelete: 'set null' }),
  ord: smallint('ord').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.entryId, t.participantId] }), index('shares_trip_participant_idx').on(t.tripId, t.participantId)]);

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey(),
  entryId: uuid('entry_id').notNull().references(() => entries.id, { onDelete: 'cascade' }),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  blobKey: text('blob_key').notNull(),
  bytes: bigint('bytes', { mode: 'bigint' }).notNull(),
  mime: text('mime').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('attachments_trip_idx').on(t.tripId, t.uploadedAt)]);

export const entryHistory = pgTable('entry_history', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  entryId: uuid('entry_id').notNull(),
  tripId: uuid('trip_id').notNull(),
  version: integer('version').notNull(),
  actor: uuid('actor'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  snapshot: jsonb('snapshot').notNull(),
}, (t) => [index('entry_history_entry_idx').on(t.entryId, t.version)]);

export const schemaMigrations = pgTable('schema_migrations', {
  name: text('name').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});

// `boolean` is imported for future use by the attachments/receipt flags; keep the import honest.
export const _types = { boolean };
