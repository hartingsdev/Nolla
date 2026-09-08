import { type WireEntry } from '@vst/domain';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly current?: unknown) { super(message); this.name = 'ApiError'; }
}
export class NetworkError extends Error { constructor(msg: string) { super(msg); this.name = 'NetworkError'; } }

export interface Feed {
  seq: string;
  entries: (WireEntry & { version: number; seq: string })[];
  participants: { id: string; displayName: string; userId: string | null; joinedAt: string; tombstonedAt: string | null; seq: string }[];
  trip: { id: string; name: string; baseCcy: string; timezone: string; status: 'open' | 'settling' | 'closed'; seq: string; metaSeq: string } | null;
  more: boolean;
}
export interface EntryRecord extends WireEntry { tripId: string; version: number; seq: string; updatedAt: string }

export interface Actor { userId: string; displayName: string | null }
/** One recorded state of an entry, plus who replaced it and when (FR-10.2). */
export interface EntryRevision { version: number; at: string; actor: Actor | null; snapshot: WireEntry }
export interface EntryHistory { entryId: string; createdAt: string; createdBy: Actor | null; revisions: EntryRevision[]; current: EntryRecord }
