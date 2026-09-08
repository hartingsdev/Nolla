import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { uuidv7 } from '../ids';
import { useApi } from '../sync/useSync';
import { useTripMeta } from '../selectors';
import { space, useTheme } from '../theme';
import { Body, Card, Chip, H2, Row } from './ui';

interface Shown { id: string; url: string; mime: string }

/**
 * Receipts for one entry (FR-2.5). Bytes go straight from the device to storage through a
 * presigned URL; the API only ever sees metadata. Local-only trips have no server to hold
 * them, so the section explains that instead of failing.
 */
export function Receipts({ entryId, editable }: { entryId: string; editable: boolean }) {
  const { t } = useTranslation();
  const th = useTheme();
  const api = useApi();
  const meta = useTripMeta();
  const tripId = meta?.id ?? '';
  const remote = meta?.remote ?? false;
  const [items, setItems] = useState<Shown[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);

  // One mounted flag for both fetches, so a screen left before a response resolves stays quiet.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  /** Returns the list, or null when it could not be fetched (offline: keep what we have). */
  const load = useCallback(async (): Promise<Shown[] | null> => {
    if (!remote) return null;
    try {
      const r = await api.listAttachments(tripId, entryId);
      return r.attachments.map((a) => ({ id: a.id, url: a.url, mime: a.mime }));
    } catch { return null; }
  }, [api, tripId, entryId, remote]);

  const refresh = useCallback(async () => { const next = await load(); if (next && mounted.current) setItems(next); }, [load]);

  useEffect(() => {
    void (async () => { const next = await load(); if (mounted.current && next) setItems(next); })();
  }, [load]);

  useEffect(() => {
    if (!remote) return;
    void api.retention(tripId).then((r) => { if (mounted.current) setRetentionDays(r.retentionDays); }).catch(() => { /* optional */ });
  }, [api, tripId, remote]);

  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setError(t('receipt.permission')); return; }
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.6, mediaTypes: ['images'] })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'] });
    if (res.canceled || !res.assets[0]) return;
    await upload(res.assets[0].uri);
  };

  const upload = async (uri: string) => {
    setBusy(true);
    try {
      const blob = await (await fetch(uri)).blob();
      const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type : 'image/jpeg';
      const id = uuidv7();
      const presigned = await api.presignAttachment(tripId, entryId, { id, mime, bytes: blob.size });
      await api.uploadBlob(presigned.upload.url, presigned.upload.headers, blob);
      await api.confirmAttachment(tripId, id, blob.size);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const remove = (id: string) => {
    const doIt = () => { void api.deleteAttachment(tripId, id).then(refresh).catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)); }); };
    if (Platform.OS === 'web') { if (globalThis.confirm(t('receipt.confirmDelete'))) doIt(); return; }
    Alert.alert(t('receipt.confirmDelete'), undefined, [{ text: t('entry.cancel'), style: 'cancel' }, { text: t('receipt.delete'), style: 'destructive', onPress: doIt }]);
  };

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <H2>{t('receipt.title')}</H2>
        {items.length > 0 && <Body muted style={{ fontSize: 13 }}>{t('receipt.count', { count: items.length })}</Body>}
      </Row>
      {!remote ? <Body muted style={{ fontSize: 13 }}>{t('receipt.localOnly')}</Body> : (
        <>
          {items.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
              {items.map((a) => (
                <Pressable key={a.id} onLongPress={() => { if (editable) remove(a.id); }} accessibilityRole="image" accessibilityLabel={t('receipt.title')}>
                  <Image source={{ uri: a.url }} style={{ width: 96, height: 128, borderRadius: 8, backgroundColor: th.bg }} resizeMode="cover" />
                </Pressable>
              ))}
            </ScrollView>
          )}
          {editable && (
            <Row>
              {Platform.OS !== 'web' && <Chip label={t('receipt.camera')} selected={false} onPress={() => { void pick('camera'); }} disabled={busy} />}
              <Chip label={t('receipt.library')} selected={false} onPress={() => { void pick('library'); }} disabled={busy} />
            </Row>
          )}
          {busy && <Body muted style={{ fontSize: 13 }}>{t('receipt.uploading')}</Body>}
          {error && <Body style={{ color: th.negative, fontSize: 13 }}>{error}</Body>}
          {retentionDays !== null && items.length > 0 && <Body muted style={{ fontSize: 12 }}>{t('receipt.retention', { days: retentionDays })}</Body>}
          <View />
        </>
      )}
    </Card>
  );
}
