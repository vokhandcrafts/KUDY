import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Location from 'expo-location';
import { createSession } from './src/session.mjs';

const stops = [
  { id: 'crane', label: 'Журавель', transcript: 'Сінтэтычны сігнал першай кропкі.', x: 0, y: 0, radiusM: 20, audio: require('./assets/crane.wav') },
  { id: 'gate', label: 'Брама', transcript: 'Сінтэтычны сігнал другой кропкі.', x: 35, y: 0, radiusM: 20, audio: require('./assets/gate.wav') },
  { id: 'fountain', label: 'Фантан', transcript: 'Сінтэтычны сігнал трэцяй кропкі.', x: 70, y: 0, radiusM: 20, audio: require('./assets/fountain.wav') },
];

export default function App() {
  const session = useMemo(() => createSession(stops), []);
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const playerStatus = useAudioPlayerStatus(player);
  const [snapshot, setSnapshot] = useState(session.snapshot());
  const [permission, setPermission] = useState('not-requested');
  const [lastFixAt, setLastFixAt] = useState<string>('never');
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const origin = useRef<{ latitude: number; longitude: number } | null>(null);

  const refresh = () => setSnapshot(session.snapshot());
  const play = (id: string, manual = false) => {
    if (manual) session.manualPlay(id);
    const stop = stops.find((item) => item.id === id);
    if (!stop) return;
    player.replace(stop.audio);
    player.play();
    refresh();
  };

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'duckOthers' });
    return () => { subscription.current?.remove(); player.pause(); };
  }, [player]);

  useEffect(() => {
    if (playerStatus.didJustFinish) { session.audioFinished(); refresh(); }
  }, [playerStatus.didJustFinish, session]);

  const acquireGps = async () => {
    const foreground = await Location.requestForegroundPermissionsAsync();
    setPermission(`foreground:${foreground.status}`);
    if (foreground.status !== 'granted') {
      session.locationUnavailable('permission-denied');
      refresh();
      return;
    }
    try {
      const watch = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 1 },
      (fix) => {
        if (!origin.current) origin.current = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
        const anchor = origin.current;
        const x = (fix.coords.longitude - anchor.longitude) * 111_320 * Math.cos(anchor.latitude * Math.PI / 180);
        const y = (fix.coords.latitude - anchor.latitude) * 110_540;
        const before = session.snapshot().playing;
        session.locationFix({ x, y, accuracyM: fix.coords.accuracy ?? 999, ageMs: Date.now() - fix.timestamp, nowMs: Date.now() });
        setLastFixAt(new Date().toISOString());
        const after = session.snapshot().playing;
        if (after && after !== before) play(after);
        refresh();
      },
    );
      subscription.current?.remove();
      subscription.current = watch;
    } catch {
      session.locationUnavailable('subscription-failed');
      setPermission('foreground:granted; subscription:failed');
      refresh();
    }
  };

  const start = async () => {
    session.start({ packageReady: true, version: 'synthetic-v1' });
    refresh();
    await acquireGps();
  };
  const pause = () => { subscription.current?.remove(); subscription.current = null; player.pause(); session.pause(); refresh(); };
  const resume = async () => { session.resume(); refresh(); await acquireGps(); };
  const end = () => { subscription.current?.remove(); subscription.current = null; player.pause(); session.end(); refresh(); };

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>KUDY GPS/audio spike</Text>
    <Text>session: {snapshot.state}</Text><Text>location owner: {snapshot.locationOwner ?? 'none'}</Text>
    <Text>player: {snapshot.playing ?? 'idle'} (instances: {snapshot.playerCount})</Text>
    <Text>permission: {permission}</Text><Text>last local fix: {lastFixAt}</Text>
    <View style={styles.row}>
      {snapshot.state === 'idle' && <Button title="Start" onPress={() => void start()} />}
      {snapshot.state === 'active' && <Button title="Pause" onPress={pause} />}
      {snapshot.state === 'paused' && <Button title="Resume" onPress={() => void resume()} />}
      {snapshot.state !== 'idle' && snapshot.state !== 'finished' && <Button title="End" onPress={end} />}
    </View>
    {stops.map((stop) => <View key={stop.id} style={styles.card}>
      <Text style={styles.stop}>{stop.label}</Text><Text>{stop.transcript}</Text>
      <Button title="Play" onPress={() => play(stop.id, true)} />
    </View>)}
    <Text style={styles.note}>Coordinates are transformed to relative metres in memory and are never sent or displayed.</Text>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f7f1e5' }, content: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '700' }, row: { flexDirection: 'row', gap: 12 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, gap: 8 }, stop: { fontSize: 18, fontWeight: '600' },
  note: { color: '#554c40', marginTop: 12 },
});
