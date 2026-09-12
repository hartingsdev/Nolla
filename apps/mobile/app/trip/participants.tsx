import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useEntries, useMeId, useParticipants, useTripMeta } from '../../src/selectors';
import { useStore } from '../../src/store';
import { todayLocal, uuidv7 } from '../../src/ids';
import { useApi } from '../../src/sync/useSync';
import { useTheme } from '../../src/theme';
import { ParticipantRow } from '../../src/components/ParticipantRow';
import { Body, Button, Card, Divider, H2, Row, Screen } from '../../src/components/ui';

export default function Participants() {
  const { t } = useTranslation();
  const th = useTheme();
  const api = useApi();
  const participants = useParticipants();
  const meId = useMeId();
  const meta = useTripMeta();
  const add = useStore((s) => s.addParticipant);
  const remove = useStore((s) => s.removeParticipant);
  const entries = useEntries();
  const [name, setName] = useState('');
  /** NFR-16: the form says what it needs, and only complains once asked to save. */
  const [tried, setTried] = useState(false);
  // Only the server knows whether I may rename other people; a local trip has no roles at all.
  const [serverAdmin, setServerAdmin] = useState(false);
  const remote = meta?.remote ?? false;
  const admin = !remote || serverAdmin;
  const tripId = meta?.id ?? '';

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void api.getTrip(tripId).then((r) => { if (!cancelled) setServerAdmin(r.me.role === 'admin'); }).catch(() => { /* offline: assume not */ });
    return () => { cancelled = true; };
  }, [api, tripId, remote]);

  const referenced = new Set(entries.flatMap((e) => [...e.payments.map((p) => p.participantId), ...e.shares.map((s) => s.participantId)]));
  const nameMissing = !name.trim();
  const submit = () => {
    setTried(true);
    if (nameMissing) return;
    add({ id: uuidv7(), name: name.trim() }, todayLocal());
    setName('');
    setTried(false);
  };
  return (
    <Screen>
      <Card>
        <H2 required>{t('participants.add')}</H2>
        <Row>
          <TextInput value={name} onChangeText={setName} onSubmitEditing={submit} placeholder={t('participants.namePlaceholder')} placeholderTextColor={th.muted}
            style={{ flex: 1, backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: tried && nameMissing ? th.negative : th.border }} accessibilityLabel={t('participants.namePlaceholder')} />
          <Button label={t('common.ok')} onPress={submit} />
        </Row>
        {tried && nameMissing && <Body style={{ color: th.negative }}>{t('participants.nameRequired')}</Body>}
      </Card>
      <Card>
        {participants.map((p, i) => (
          <View key={p.id}>
            {i > 0 && <Divider />}
            <ParticipantRow
              p={p}
              isMe={p.id === meId}
              canRename={admin || p.id === meId}
              right={referenced.has(p.id as never)
                ? <Body muted style={{ fontSize: 12 }}>{t('participants.cannotRemove')}</Body>
                : <Button kind="secondary" label={t('entry.delete')} onPress={() => { remove(p.id); }} />}
            />
          </View>
        ))}
      </Card>
    </Screen>
  );
}
