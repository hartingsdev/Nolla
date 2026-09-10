import { useCallback, useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type Participant } from '../store';
import { formatDate } from '../format';
import { useApi } from '../sync/useSync';
import { useStore } from '../store';
import { useTripMeta, activeTrip } from '../selectors';
import { space, useTheme } from '../theme';
import { Body, Chip, Row } from './ui';

interface Props {
  readonly p: Participant;
  readonly isMe: boolean;
  readonly canRename: boolean;
  readonly right: React.ReactNode;
}

/**
 * One participant, with the option to correct their name (FR-1.12).
 *
 * The old names are worth showing rather than quietly replacing: in a shared
 * trip a name is how everyone else recognises whose money an entry is, so a
 * rename should be visible to them, not silent.
 */
export function ParticipantRow({ p, isMe, canRename, right }: Props) {
  const { t, i18n } = useTranslation();
  const th = useTheme();
  const api = useApi();
  const meta = useTripMeta();
  const rename = useStore((s) => s.renameParticipant);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.name);
  const [past, setPast] = useState<string[]>([]);
  const remote = meta?.remote ?? false;
  const tripId = meta?.id ?? '';

  // A rename travels through the outbox, so the server does not know it yet when
  // Save is pressed. Watching the queued op means the history reloads exactly once
  // more — when the write has actually landed — instead of polling for it.
  const pendingRename = useStore((s) => {
    const trip = activeTrip(s);
    return trip?.outbox.some((o) => o.kind === 'renameParticipant' && o.participantId === p.id) ?? false;
  });

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const loadNames = useCallback(async (): Promise<string[] | null> => {
    if (!remote) return null;
    try { return (await api.participantNames(tripId, p.id)).names.map((n) => `${n.displayName} · ${formatDate(n.at.slice(0, 10), i18n.language)}`); }
    catch { return null; }
  }, [api, tripId, p.id, remote, i18n.language]);

  useEffect(() => {
    void (async () => { const n = await loadNames(); if (mounted.current && n) setPast(n); })();
  }, [loadNames, p.name, pendingRename]);

  const save = () => { rename(p.id, draft); setEditing(false); };

  return (
    <View style={{ gap: 4 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        {editing ? (
          <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={save} autoFocus accessibilityLabel={t('participants.rename')}
            style={{ flex: 1, backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 10, fontSize: 16, borderWidth: 1, borderColor: th.border }} />
        ) : (
          <Body>{p.name}{isMe ? ` (${t('participants.you')})` : ''}</Body>
        )}
        {editing
          ? <Row><Chip label={t('entry.save')} selected={false} onPress={save} disabled={!draft.trim()} /><Chip label={t('entry.cancel')} selected={false} onPress={() => { setEditing(false); setDraft(p.name); }} /></Row>
          : right}
      </Row>
      {!editing && canRename && (
        <Row><Chip label={t('participants.rename')} selected={false} onPress={() => { setDraft(p.name); setEditing(true); }} /></Row>
      )}
      {past.length > 0 && (
        <Body muted style={{ fontSize: 12 }}>{t('participants.formerly')}: {past.join(' · ')}</Body>
      )}
      <View style={{ height: space.xs }} />
    </View>
  );
}
