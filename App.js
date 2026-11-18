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
const GRID_COLS = 23; // A à W
const GRID_ROWS = 14; // 1 à 14

export default function App() {
  // Configuration serveur
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [autoPoll, setAutoPoll] = useState(false);

  // État de la tâche courante
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 1, height: 1 });

  // Dimensions réelles du conteneur d'image affiché à l'écran
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Ajustement du recadrage de la scène du bas (en pourcentage de l'image totale)
  // Par défaut : l'en-tête occupe environ les 32% supérieurs, la scène commence à 32% jusqu'à 100%
  const [cropTopPct, setCropTopPct] = useState(0.32);
  const [cropBottomPct, setCropBottomPct] = useState(1.0);
  const [cropLeftPct, setCropLeftPct] = useState(0.0);
  const [cropRightPct, setCropRightPct] = useState(0.98);
  const [showCropControls, setShowCropControls] = useState(false);

  // Points sélectionnés par l'utilisateur (coordonnées en pixels relatives au conteneur)
  const [selectedPoints, setSelectedPoints] = useState([]);

  const pollTimerRef = useRef(null);

  // Récupérer les dimensions naturelles de l'image dès qu'elle est chargée
  useEffect(() => {
    if (!imageUrl) return;
    Image.getSize(
      imageUrl,
      (width, height) => {
        setImageNaturalSize({ width, height });
      },
      (err) => {
        console.warn('Impossible de lire la taille de l’image:', err);
      }
    );
  }, [imageUrl]);

  // Récupération de la tâche suivante depuis Render
  const fetchNextJob = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const cleanBase = serverUrl.trim().replace(/\/$/, '');
      const res = await fetch(`${cleanBase}/api/next`);

      if (res.status === 204) {
        if (!silent) Alert.alert('Info', 'Aucune tâche en attente sur le serveur.');
        return;
      }

      if (!res.ok) {
        throw new Error(`Erreur serveur HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data && data.id && data.imageDataUrl) {
        // Éviter de recharger la même tâche en boucle
        if (data.id !== jobId) {
          setJobId(data.id);
          setImageUrl(data.imageDataUrl);
          setSelectedPoints([]);
        }
      }
    } catch (error) {
      if (!silent) Alert.alert('Erreur réseau', error.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Surveillance automatique (Polling toutes les 3 secondes si activé)
  useEffect(() => {
    if (autoPoll && !imageUrl) {
      pollTimerRef.current = setInterval(() => {
        fetchNextJob(true);
      }, 3000);
    } else if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [autoPoll, imageUrl, serverUrl]);

  // Calcul des limites en pixels de la zone de scène recadrée à l'écran
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

  // Conversion d'un point (x, y) en coordonnée de grille "Lettre;Rangée"
  const pointToGridCell = (pt) => {
    const rect = getCropRectPixels();
    if (rect.cropWidth <= 0 || rect.cropHeight <= 0) return null;

    // Position relative à l'intérieur du cadre vert (scène du bas)
    const relX = pt.x - rect.left;
    const relY = pt.y - rect.top;

    const colWidth = rect.cropWidth / GRID_COLS;
    const rowHeight = rect.cropHeight / GRID_ROWS;

    let colIdx = Math.floor(relX / colWidth);
    let rowIdx = Math.floor(relY / rowHeight);

    colIdx = Math.max(0, Math.min(GRID_COLS - 1, colIdx));
    rowIdx = Math.max(0, Math.min(GRID_ROWS - 1, rowIdx));

    // Conversion index colonne -> Lettre (0 -> A, 22 -> W)
    let colLetter = '';
    let tempCol = colIdx + 1;
    while (tempCol > 0) {
      const modulo = (tempCol - 1) % 26;
      colLetter = String.fromCharCode(65 + modulo) + colLetter;
      tempCol = Math.floor((tempCol - modulo) / 26);
    }

    return `${colLetter};${rowIdx + 1}`;
  };

  // Gestion du toucher sur l'image
  const handleImagePress = (event) => {
    if (!imageUrl) return;
    const { locationX, locationY } = event.nativeEvent;
    const rect = getCropRectPixels();

    // Vérifier si l'utilisateur a bien cliqué dans la scène du bas (cadre vert)
    if (
      locationX < rect.left ||
      locationX > rect.right ||
      locationY < rect.top ||
      locationY > rect.bottom
    ) {
      Alert.alert(
        'Hors zone',
        'Touchez directement les monstres à l’intérieur du cadre vert de la scène du bas.'
      );
      return;
    }

    if (selectedPoints.length < 2) {
      setSelectedPoints([...selectedPoints, { x: locationX, y: locationY }]);
    } else {
      // Si 2 points sont déjà placés, un 3e clic recommence la sélection
      setSelectedPoints([{ x: locationX, y: locationY }]);
    }
  };

  // Formater les 2 points sélectionnés
  const getFormattedResponse = () => {
    if (selectedPoints.length !== 2) return null;
    const cells = selectedPoints.map(pointToGridCell).filter(Boolean);
    if (cells.length !== 2) return null;
    return cells.join('\n');
  };

  // Envoi des coordonnées vers Render
  const sendResultToServer = async () => {
    const formattedAnswer = getFormattedResponse();
    if (!formattedAnswer) {
      Alert.alert('Sélection incomplète', 'Veuillez sélectionner exactement 2 monstres.');
      return;
    }

    setLoading(true);
    try {
      const cleanBase = serverUrl.trim().replace(/\/$/, '');
      const res = await fetch(`${cleanBase}/api/result/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: formattedAnswer }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Erreur HTTP ${res.status}`);
      }

      // Réinitialiser l'écran pour la prochaine tâche
      setImageUrl(null);
      setJobId(null);
      setSelectedPoints([]);

      if (autoPoll) {
        fetchNextJob(true);
      } else {
        Alert.alert('Envoyé !', `Réponse transmise :\n\n${formattedAnswer}`);
      }
    } catch (error) {
      Alert.alert('Échec de l’envoi', error.message);
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
        {/* Barre supérieure */}
        <View style={styles.header}>
          <Text style={styles.title}>ONLY-FAUCET Mobile</Text>
          <TouchableOpacity
            style={[styles.pollBadge, autoPoll ? styles.pollActive : styles.pollInactive]}
            onPress={() => setAutoPoll(!autoPoll)}
          >
            <Text style={styles.pollText}>{autoPoll ? 'Auto : ON' : 'Auto : OFF'}</Text>
          </TouchableOpacity>
        </View>

        {/* Champ URL serveur */}
        <View style={styles.serverRow}>
          <TextInput
            style={styles.serverInput}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://only-faucet.onrender.com"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => fetchNextJob(false)}
            disabled={loading}
          >
            <Text style={styles.refreshBtnText}>Charger</Text>
          </TouchableOpacity>
        </View>

        {loading && <ActivityIndicator size="large" color="#3b82f6" style={styles.loader} />}

        {imageUrl ? (
          <View style={styles.workspace}>
            {/* Barre d'outils d'ajustement du recadrage */}
            <View style={styles.toolbar}>
              <Text style={styles.jobLabel}>Tâche : {String(jobId).slice(0, 8)}…</Text>
              <TouchableOpacity
                style={styles.adjustToggleBtn}
                onPress={() => setShowCropControls(!showCropControls)}
              >
                <Text style={styles.adjustToggleText}>
                  {showCropControls ? 'Masquer ajustement' : 'Ajuster cadre scène'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Panneau d'ajustement précis du recadrage de la scène du bas */}
            {showCropControls && (
              <View style={styles.cropControlsBox}>
                <Text style={styles.cropHelp}>
                  Alignez le cadre vert exactement sur les bords de la scène du bas :
                </Text>

                <View style={styles.cropControlRow}>
                  <Text style={styles.cropLabel}>Haut (En-tête) :</Text>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setCropTopPct((v) => Math.max(0, +(v - 0.01).toFixed(2)))}
                  >
                    <Text style={styles.stepBtnText}>▲ Monter</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setCropTopPct((v) => Math.min(0.8, +(v + 0.01).toFixed(2)))}
                  >
                    <Text style={styles.stepBtnText}>▼ Descendre</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.cropControlRow}>
                  <Text style={styles.cropLabel}>Bas :</Text>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setCropBottomPct((v) => Math.max(0.5, +(v - 0.01).toFixed(2)))}
                  >
                    <Text style={styles.stepBtnText}>▲ Monter</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setCropBottomPct((v) => Math.min(1.0, +(v + 0.01).toFixed(2)))}
                  >
                    <Text style={styles.stepBtnText}>▼ Descendre</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.cropControlRow}>
                  <Text style={styles.cropLabel}>Droite :</Text>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setCropRightPct((v) => Math.max(0.7, +(v - 0.01).toFixed(2)))}
                  >
                    <Text style={styles.stepBtnText}>◀ Réduire</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setCropRightPct((v) => Math.min(1.0, +(v + 0.01).toFixed(2)))}
                  >
                    <Text style={styles.stepBtnText}>▶ Étendre</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Zone interactive contenant l'image composite complète */}
            <TouchableOpacity
              activeOpacity={1}
              onPress={handleImagePress}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                setContainerSize({ width, height });
              }}
              style={[styles.imageWrapper, { aspectRatio }]}
            >
              <Image source={{ uri: imageUrl }} style={styles.fullImage} resizeMode="stretch" />

              {/* Cadre vert délimitant la scène du bas utilisée pour la grille 23x14 */}
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

              {/* Marqueurs des 2 monstres touchés */}
              {selectedPoints.map((pt, idx) => {
                const cellCode = pointToGridCell(pt);
                return (
                  <View
                    key={idx}
                    pointerEvents="none"
                    style={[styles.markerContainer, { left: pt.x - 16, top: pt.y - 16 }]}
                  >
                    <View style={styles.markerCircle}>
                      <Text style={styles.markerNumber}>{idx + 1}</Text>
                    </View>
                    {cellCode && <Text style={styles.markerBadge}>{cellCode}</Text>}
                  </View>
                );
              })}
            </TouchableOpacity>

            {/* Aperçu des coordonnées calculées */}
            <View style={styles.previewBox}>
              <Text style={styles.previewTitle}>
                Coordonnées sélectionnées ({selectedPoints.length}/2) :
              </Text>
              <Text style={styles.previewCode}>
                {selectedPoints.length === 0
                  ? 'Touchez les 2 monstres dans le cadre vert'
                  : selectedPoints.map((p, i) => `Monstre ${i + 1} → ${pointToGridCell(p)}`).join('   |   ')}
              </Text>
            </View>

            {/* Boutons d'action */}
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.clearBtn]}
                onPress={() => setSelectedPoints([])}
              >
                <Text style={styles.actionBtnText}>Effacer</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  styles.submitBtn,
                  selectedPoints.length !== 2 && styles.disabledBtn,
                ]}
                onPress={sendResultToServer}
                disabled={selectedPoints.length !== 2 || loading}
              >
                <Text style={styles.actionBtnText}>Envoyer ({previewResult ? previewResult.replace('\n', ' / ') : '0/2'})</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>En attente d’une capture…</Text>
            <Text style={styles.emptySub}>
              Cliquez sur « Charger » ou activez le mode « Auto : ON » pour récupérer automatiquement les images depuis Render.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b1220',
  },
  scrollContainer: {
    padding: 14,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 19,
    fontWeight: 'bold',
    color: '#f1f5f9',
  },
  pollBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pollActive: {
    backgroundColor: '#059669',
  },
  pollInactive: {
    backgroundColor: '#334155',
  },
  pollText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  serverRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  serverInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    fontSize: 13,
  },
  refreshBtn: {
    backgroundColor: '#2563eb',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  refreshBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  loader: {
    marginVertical: 16,
  },
  workspace: {
    width: '100%',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  jobLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  adjustToggleBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#475569',
  },
  adjustToggleText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  cropControlsBox: {
    backgroundColor: '#1e293b',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cropHelp: {
    color: '#cbd5e1',
    fontSize: 12,
    marginBottom: 8,
  },
  cropControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  cropLabel: {
    color: '#94a3b8',
    fontSize: 12,
    width: 105,
  },
  stepBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  stepBtnText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '600',
  },
  imageWrapper: {
    width: '100%',
    backgroundColor: '#000000',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#475569',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  cropOverlay: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.06)',
  },
  markerContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  markerCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    borderWidth: 2,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerNumber: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  markerBadge: {
    marginTop: 2,
    backgroundColor: '#0f172a',
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: 'bold',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  previewBox: {
    backgroundColor: '#1e293b',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  previewTitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 4,
  },
  previewCode: {
    color: '#10b981',
    fontWeight: 'bold',
    fontSize: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  clearBtn: {
    backgroundColor: '#475569',
  },
  submitBtn: {
    backgroundColor: '#10b981',
  },
  disabledBtn: {
    backgroundColor: '#1e293b',
    opacity: 0.6,
  },
  actionBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  emptyState: {
    marginTop: 60,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: '#e2e8f0',
    fontSize: 17,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySub: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
});