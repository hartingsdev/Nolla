import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useEntries, useMeId, useParticipants } from '../src/selectors';
import { useStore } from '../src/store';
import { todayLocal, uuidv7 } from '../src/ids';
import { useTheme } from '../src/theme';
import { Body, Button, Card, Divider, H2, Row, Screen } from '../src/components/ui';

export default function Participants() {
  const { t } = useTranslation();
  const th = useTheme();
  const participants = useParticipants();
  const meId = useMeId();
  const add = useStore((s) => s.addParticipant);
  const remove = useStore((s) => s.removeParticipant);
  const entries = useEntries();
  const [name, setName] = useState('');
  const referenced = new Set(entries.flatMap((e) => [...e.payments.map((p) => p.participantId), ...e.shares.map((s) => s.participantId)]));
  const submit = () => { const n = name.trim(); if (!n) return; add({ id: uuidv7(), name: n }, todayLocal()); setName(''); };
  return (
    <Screen>
      <Card>
        <H2>{t('participants.add')}</H2>
        <Row>
          <TextInput value={name} onChangeText={setName} onSubmitEditing={submit} placeholder={t('participants.namePlaceholder')} placeholderTextColor={th.muted}
            style={{ flex: 1, backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: th.border }} accessibilityLabel={t('participants.namePlaceholder')} />
          <Button label={t('common.ok')} onPress={submit} disabled={!name.trim()} />
        </Row>
      </Card>
      <Card>
        {participants.map((p, i) => (
          <View key={p.id}>
            {i > 0 && <Divider />}
            <Row style={{ justifyContent: 'space-between' }}>
              <Body>{p.name}{p.id === meId ? ` (${t('participants.you')})` : ''}</Body>
              {referenced.has(p.id as never)
                ? <Body muted style={{ fontSize: 12 }}>{t('participants.cannotRemove')}</Body>
                : <Button kind="secondary" label={t('entry.delete')} onPress={() => { remove(p.id); }} />}
            </Row>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
