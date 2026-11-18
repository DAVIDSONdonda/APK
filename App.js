import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  TextInput,
  SafeAreaView,
  StatusBar
} from 'react-native';

const DEFAULT_SERVER_URL = 'https://only-faucet.onrender.com';
const GRID_COLS = 23; 
const GRID_ROWS = 14; 

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [connected, setConnected] = useState(false);

  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 1, height: 1 });

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const [cropTopPct, setCropTopPct] = useState(0.32);
  const [cropBottomPct, setCropBottomPct] = useState(1.0);
  const [cropLeftPct, setCropLeftPct] = useState(0.0);
  const [cropRightPct, setCropRightPct] = useState(0.98);
  const [showCropControls, setShowCropControls] = useState(false);

  const [selectedPoints, setSelectedPoints] = useState([]);
  const socketRef = useRef(null);
  const pingTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const manualCloseRef = useRef(false);

  useEffect(() => {
    if (!imageUrl) return;
    Image.getSize(imageUrl, (width, height) => {
      setImageNaturalSize({ width, height });
    }, () => {});
  }, [imageUrl]);

  const connectSocket = () => {
    const cleanBase = serverUrl.trim().replace(/\/$/, '');
    const wsUrl = cleanBase
      .replace(/^https:/i, 'wss:')
      .replace(/^http:/i, 'ws:');

    if (!/^wss?:\/\//i.test(wsUrl)) {
      Alert.alert('URL invalide', 'Utilisez une URL http:// ou https:// valide.');
      return;
    }

    if (socketRef.current && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socketRef.current.readyState)) {
      return;
    }

    setLoading(true);
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      setLoading(false);
      socket.send(JSON.stringify({ type: 'register_mobile' }));

      clearInterval(pingTimerRef.current);
      pingTimerRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, 5 * 60 * 1000);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'new_job' && data.id && data.imageDataUrl) {
          setJobId(data.id);
          setImageUrl(data.imageDataUrl);
          setSelectedPoints([]);
          setLoading(false);
          return;
        }

        if (data.type === 'error') {
          Alert.alert('Erreur serveur', data.error || 'Erreur WebSocket.');
        }
      } catch (error) {
        console.error('Message WebSocket invalide :', error);
      }
    };

    socket.onerror = () => {
      setConnected(false);
      setLoading(false);
    };

    socket.onclose = () => {
      setConnected(false);
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
      if (!manualCloseRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connectSocket, 5000);
      }
    };
  };

  useEffect(() => {
    manualCloseRef.current = false;
    connectSocket();

    return () => {
      manualCloseRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      clearInterval(pingTimerRef.current);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [serverUrl]);

  const getCropRectPixels = () => {
    const { width, height } = containerSize;
    return {
      left: width * cropLeftPct,
      top: height * cropTopPct,
      right: width * cropRightPct,
      bottom: height * cropBottomPct,
      cropWidth: width * (cropRightPct - cropLeftPct),
      cropHeight: height * (cropBottomPct - cropTopPct),
    };
  };

  const pointToGridCell = (pt) => {
    const rect = getCropRectPixels();
    if (rect.cropWidth <= 0 || rect.cropHeight <= 0) return null;

    const relX = pt.x - rect.left;
    const relY = pt.y - rect.top;

    const colWidth = rect.cropWidth / GRID_COLS;
    const rowHeight = rect.cropHeight / GRID_ROWS;

    let colIdx = Math.floor(relX / colWidth);
    let rowIdx = Math.floor(relY / rowHeight);

    colIdx = Math.max(0, Math.min(GRID_COLS - 1, colIdx));
    rowIdx = Math.max(0, Math.min(GRID_ROWS - 1, rowIdx));

    let colLetter = '';
    let tempCol = colIdx + 1;
    while (tempCol > 0) {
      const modulo = (tempCol - 1) % 26;
      colLetter = String.fromCharCode(65 + modulo) + colLetter;
      tempCol = Math.floor((tempCol - modulo) / 26);
    }

    return `${colLetter};${rowIdx + 1}`;
  };

  const handleImagePress = (event) => {
    if (!imageUrl) return;
    const { locationX, locationY } = event.nativeEvent;
    const rect = getCropRectPixels();

    if (
      locationX < rect.left ||
      locationX > rect.right ||
      locationY < rect.top ||
      locationY > rect.bottom
    ) {
      Alert.alert('Hors zone', 'Touchez à l’intérieur du cadre vert de la scène.');
      return;
    }

    if (selectedPoints.length < 2) {
      setSelectedPoints([...selectedPoints, { x: locationX, y: locationY }]);
    } else {
      setSelectedPoints([{ x: locationX, y: locationY }]);
    }
  };

  const getFormattedResponse = () => {
    if (selectedPoints.length !== 2) return null;
    const cells = selectedPoints.map(pointToGridCell).filter(Boolean);
    if (cells.length !== 2) return null;
    return cells.join('\n');
  };

  const sendResultToServer = async () => {
    const formattedAnswer = getFormattedResponse();
    if (!formattedAnswer) return;

    setLoading(true);
    try {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error('La connexion WebSocket n’est pas active.');
      }

      socket.send(JSON.stringify({
        type: 'submit_result',
        id: jobId,
        response: formattedAnswer,
      }));

      setImageUrl(null);
      setJobId(null);
      setSelectedPoints([]);
      Alert.alert('Envoyé !', `Réponse transmise :\n\n${formattedAnswer}`);
    } catch (error) {
      Alert.alert('Échec', error.message);
    } finally {
      setLoading(false);
    }
  };

  const cropRect = getCropRectPixels();
  const previewResult = getFormattedResponse();
  const aspectRatio =
    imageNaturalSize.width > 1 && imageNaturalSize.height > 1
      ? imageNaturalSize.width / imageNaturalSize.height
      : 1.15;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0b1220" />
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <Text style={styles.title}>ONLY-FAUCET Mobile</Text>
          <TouchableOpacity
            style={[styles.pollBadge, connected ? styles.pollActive : styles.pollInactive]}
            onPress={connectSocket}
          >
            <Text style={styles.pollText}>{connected ? 'WebSocket : ON' : 'WebSocket : OFF'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.serverRow}>
          <TextInput
            style={styles.serverInput}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://only-faucet.onrender.com"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.refreshBtn} onPress={connectSocket} disabled={loading}>
            <Text style={styles.refreshBtnText}>Charger</Text>
          </TouchableOpacity>
        </View>

        {loading && <ActivityIndicator size="large" color="#3b82f6" style={styles.loader} />}

        {imageUrl ? (
          <View style={styles.workspace}>
            <View style={styles.toolbar}>
              <Text style={styles.jobLabel}>Tâche : {String(jobId).slice(0, 8)}…</Text>
              <TouchableOpacity
                style={styles.adjustToggleBtn}
                onPress={() => setShowCropControls(!showCropControls)}
              >
                <Text style={styles.adjustToggleText}>
                  {showCropControls ? 'Masquer ajustement' : 'Ajuster cadre'}
                </Text>
              </TouchableOpacity>
            </View>

            {showCropControls && (
              <View style={styles.cropControlsBox}>
                <View style={styles.cropControlRow}>
                  <Text style={styles.cropLabel}>Haut :</Text>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => setCropTopPct(v => Math.max(0, +(v - 0.01).toFixed(2)))}>
                    <Text style={styles.stepBtnText}>▲</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => setCropTopPct(v => Math.min(0.8, +(v + 0.01).toFixed(2)))}>
                    <Text style={styles.stepBtnText}>▼</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.cropControlRow}>
                  <Text style={styles.cropLabel}>Bas :</Text>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => setCropBottomPct(v => Math.max(0.5, +(v - 0.01).toFixed(2)))}>
                    <Text style={styles.stepBtnText}>▲</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => setCropBottomPct(v => Math.min(1.0, +(v + 0.01).toFixed(2)))}>
                    <Text style={styles.stepBtnText}>▼</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity
              activeOpacity={1}
              onPress={handleImagePress}
              onLayout={(e) => setContainerSize(e.nativeEvent.layout)}
              style={[styles.imageWrapper, { aspectRatio }]}
            >
              <Image source={{ uri: imageUrl }} style={styles.fullImage} resizeMode="stretch" />

              {containerSize.width > 0 && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.cropOverlay,
                    {
                      left: cropRect.left,
                      top: cropRect.top,
                      width: cropRect.cropWidth,
                      height: cropRect.cropHeight,
                    },
                  ]}
                />
              )}

              {selectedPoints.map((pt, idx) => {
                const cellCode = pointToGridCell(pt);
                return (
                  <View key={idx} pointerEvents="none" style={[styles.markerContainer, { left: pt.x - 16, top: pt.y - 16 }]}>
                    <View style={styles.markerCircle}>
                      <Text style={styles.markerNumber}>{idx + 1}</Text>
                    </View>
                    {cellCode && <Text style={styles.markerBadge}>{cellCode}</Text>}
                  </View>
                );
              })}
            </TouchableOpacity>

            <View style={styles.previewBox}>
              <Text style={styles.previewTitle}>Sélection ({selectedPoints.length}/2) :</Text>
              <Text style={styles.previewCode}>
                {selectedPoints.length === 0
                  ? 'Touchez les 2 monstres'
                  : selectedPoints.map((p, i) => `M${i + 1} → ${pointToGridCell(p)}`).join(' | ')}
              </Text>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity style={[styles.actionBtn, styles.clearBtn]} onPress={() => setSelectedPoints([])}>
                <Text style={styles.actionBtnText}>Effacer</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.submitBtn, selectedPoints.length !== 2 && styles.disabledBtn]}
                onPress={sendResultToServer}
                disabled={selectedPoints.length !== 2 || loading}
              >
                <Text style={styles.actionBtnText}>Envoyer</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>En attente d’une capture…</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0b1220' },
  scrollContainer: { padding: 14, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 19, fontWeight: 'bold', color: '#f1f5f9' },
  pollBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  pollActive: { backgroundColor: '#059669' },
  pollInactive: { backgroundColor: '#334155' },
  pollText: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
  serverRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  serverInput: { flex: 1, backgroundColor: '#1e293b', color: '#f8fafc', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#334155', fontSize: 13 },
  refreshBtn: { backgroundColor: '#2563eb', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 8 },
  refreshBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 13 },
  loader: { marginVertical: 16 },
  workspace: { width: '100%' },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  jobLabel: { color: '#94a3b8', fontSize: 12 },
  adjustToggleBtn: { backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#475569' },
  adjustToggleText: { color: '#38bdf8', fontSize: 12, fontWeight: '600' },
  cropControlsBox: { backgroundColor: '#1e293b', padding: 10, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  cropControlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 4 },
  cropLabel: { color: '#94a3b8', fontSize: 12, width: 60 },
  stepBtn: { backgroundColor: '#334155', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  stepBtnText: { color: '#f8fafc', fontSize: 12, fontWeight: '600' },
  imageWrapper: { width: '100%', backgroundColor: '#000000', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#475569' },
  fullImage: { width: '100%', height: '100%' },
  cropOverlay: { position: 'absolute', borderWidth: 2, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.06)' },
  markerContainer: { position: 'absolute', alignItems: 'center' },
  markerCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(239, 68, 68, 0.9)', borderWidth: 2, borderColor: '#ffffff', justifyContent: 'center', alignItems: 'center' },
  markerNumber: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  markerBadge: { marginTop: 2, backgroundColor: '#0f172a', color: '#38bdf8', fontSize: 11, fontWeight: 'bold', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  previewBox: { backgroundColor: '#1e293b', padding: 10, borderRadius: 8, marginTop: 10, alignItems: 'center' },
  previewTitle: { color: '#94a3b8', fontSize: 12, marginBottom: 4 },
  previewCode: { color: '#10b981', fontWeight: 'bold', fontSize: 14 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  clearBtn: { backgroundColor: '#475569' },
  submitBtn: { backgroundColor: '#10b981' },
  disabledBtn: { backgroundColor: '#1e293b', opacity: 0.6 },
  actionBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 15 },
  emptyState: { marginTop: 60, alignItems: 'center', paddingHorizontal: 20 },
  emptyTitle: { color: '#e2e8f0', fontSize: 17, fontWeight: 'bold', marginBottom: 8 }
});
