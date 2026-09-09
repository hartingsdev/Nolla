import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type Entry } from '@vst/domain';
import { formatDate } from '../format';
import { useMeId, useNames, useWriteRules } from '../selectors';
import { useStore } from '../store';
import { space, useTheme } from '../theme';
import { Body, Button, Card, H2, Row } from './ui';

/**
 * Disputing a payment (FR-5.3).
 *
 * Only the person who received it may raise or withdraw the objection — the
 * sender cannot clear an accusation made against them, which the server enforces
 * too. The payment keeps counting toward the balances the whole time: this flags
 * a disagreement between two people, it does not undo anyone's money.
 */
export function Dispute({ entry }: { entry: Entry }) {
  const { t, i18n } = useTranslation();
  const th = useTheme();
  const names = useNames();
  const meId = useMeId();
  const rules = useWriteRules();
  const setDispute = useStore((s) => s.setDispute);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (entry.type !== 'transfer' || entry.deleted) return null;
  const recipient = entry.shares[0]?.participantId;
  const mine = meId !== null && meId === recipient;
  const d = entry.dispute;

  // A frozen or closed trip still shows an existing dispute; it just cannot take a new one.
  if (!d && (!mine || !rules.canWriteTransfer)) return null;

  const raise = () => { setDispute(entry.id, reason.trim() ? { reason: reason.trim() } : {}); setOpen(false); setReason(''); };

  return (
    <Card>
      <H2>{t('dispute.title')}</H2>
      {d ? (
        <>
          <Body style={{ color: th.negative }}>
            {t('dispute.raisedBy', { name: names.get(d.by) ?? t('history.someone'), date: formatDate(d.at.slice(0, 10), i18n.language) })}
          </Body>
          {d.reason && <Body muted>{t('dispute.reason')}: {d.reason}</Body>}
          <Body muted style={{ fontSize: 13 }}>{t('dispute.stillCounts')}</Body>
          {mine && rules.canWriteTransfer && (
            <Button kind="secondary" label={t('dispute.withdraw')} onPress={() => { setDispute(entry.id, null); }} />
          )}
        </>
      ) : open ? (
        <View style={{ gap: space.sm }}>
          <Body muted style={{ fontSize: 13 }}>{t('dispute.hint')}</Body>
          <TextInput value={reason} onChangeText={setReason} placeholder={t('dispute.reasonPlaceholder')} placeholderTextColor={th.muted}
            accessibilityLabel={t('dispute.reason')}
            style={{ backgroundColor: th.bg, color: th.text, borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: th.border }} />
          <Row>
            <Button kind="danger" label={t('dispute.confirm')} onPress={raise} />
            <Button kind="secondary" label={t('entry.cancel')} onPress={() => { setOpen(false); }} />
          </Row>
        </View>
      ) : (
        <>
          <Body muted style={{ fontSize: 13 }}>{t('dispute.hint')}</Body>
          <Button kind="secondary" label={t('dispute.raise')} onPress={() => { setOpen(true); }} />
        </>
      )}
    </Card>
  );
}
