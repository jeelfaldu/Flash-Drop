import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, Dimensions, StatusBar, SafeAreaView, Share } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import { generateServerUrl, startServer, stopServer } from '../utils/TransferServer';
import TransferServerInstance from '../utils/TransferServer';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { usePCConnectionStore } from '../store';

const { width } = Dimensions.get('window');

const PCConnectionScreen = ({ navigation }: any) => {
  const { colors, isDark, typography, layout } = useTheme();
  const { serverUrl, isServerRunning, sharedFiles, port, setServerUrl, setIsServerRunning, addFiles, reset } =
    usePCConnectionStore();

  useEffect(() => {
    startPCServer();
    return () => {
      stopServer();
      reset();
    };
  }, []);

  const startPCServer = async () => {
    try {
      await startServer(port);
      const url = await generateServerUrl();
      if (url) {
        setServerUrl(url);
        setIsServerRunning(true);
      } else {
        Alert.alert("Error", "Could not generate server URL. Ensure you are connected to Wi-Fi.");
      }
    } catch (error) {
      console.error("Error starting PC server:", error);
      Alert.alert("Error", "Failed to start PC connection server.");
    }
  };

  const handleStopServer = () => {
    stopServer();
    reset();
    navigation.goBack();
  };

  const handleSelectFiles = async () => {
    try {
      const res = await pick({ type: [types.allFiles], allowMultiSelection: true });
      const newFiles = await Promise.all(
        res.map(async (doc) => {
          let size = doc.size || 0;
          if (size === 0) {
            try {
              const stat = await RNFS.stat(doc.uri);
              size = stat.size;
            } catch (e) {
              console.log('Stat error', e);
            }
          }
          return {
            name: doc.name ?? `File_${Date.now()}`,
            size,
            type: doc.type ?? 'application/octet-stream',
            uri: doc.uri,
          };
        }),
      );
      addFiles(newFiles);
      TransferServerInstance.updateFiles(newFiles);
      Alert.alert("Success", `${newFiles.length} files shared.`);
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        // cancelled
      } else {
        console.error('Pick error', err);
        Alert.alert('Error', 'Failed to pick files');
      }
    }
  };


  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <View style={styles.headerWrapper}>
        <LinearGradient
          colors={colors.gradient}
          style={styles.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton}>
              <Icon name="arrow-left" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { fontFamily: typography.fontFamily }]}>Connect to PC</Text>
            <View style={{ width: 40 }} />
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.contentContainer}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={[styles.mainCard, { backgroundColor: colors.surface, ...layout.shadow.medium }]}>
            
            <View style={styles.illustrationContainer}>
                 <View style={[styles.iconCircle, { backgroundColor: isDark ? '#1A237E' : '#E3F2FD' }]}>
                    <Icon name="monitor-share" size={64} color="#2196F3" />
                 </View>
                 <View style={styles.pulseRing} />
            </View>

            <View style={styles.statusContainer}>
                <Text style={[styles.statusTitle, { color: colors.text }]}>
              {isServerRunning ? "Ready to Connect" : "Starting Server..."}
                </Text>
                <Text style={[styles.statusSubtitle, { color: colors.subtext }]}>
              Make sure your Phone and PC are connected to the same Wi-Fi or Hotspot.
                </Text>
            </View>

          {isServerRunning && serverUrl && (
                <View style={[styles.urlCard, { backgroundColor: isDark ? colors.surface : '#FFF', ...layout.shadow.medium }]}>
                    <Text style={[styles.urlLabel, { color: colors.subtext }]}>Enter this URL in your PC Browser:</Text>
                    <Text selectable={true} style={[styles.urlText, { color: colors.primary }]}>{serverUrl}</Text>
                    <TouchableOpacity 
                        style={styles.copyButton}
                onPress={async () => {
                  try {
                    await Share.share({ message: serverUrl, title: 'FlashDrop Server URL' });
                  } catch (e) {
                    Alert.alert('Share', serverUrl);
                  }
                        }}
                    >
                <Icon name="share-variant" size={20} color={colors.primary} />
                    </TouchableOpacity>
                </View>
            )}

            <View style={styles.instructionsContainer}>
            <InstructionItem number="1" text="Open any web browser on your PC." colors={colors} />
            <InstructionItem number="2" text="Type the URL shown above in the address bar." colors={colors} />
            <InstructionItem number="3" text="Press Enter and start sharing files!" colors={colors} />
            </View>

          {isServerRunning && (
                <View style={{ width: '100%', marginBottom: 16 }}>
                    <TouchableOpacity 
                        style={[styles.stopButton, { backgroundColor: colors.primary, marginBottom: 12, flexDirection: 'row', justifyContent: 'center' }]} 
                        onPress={handleSelectFiles}
                    >
                        <Icon name="file-plus" size={24} color="#FFF" style={{ marginRight: 8 }} />
                        <Text style={[styles.stopButtonText, { color: '#FFF' }]}>Add Files ({sharedFiles.length})</Text>
                    </TouchableOpacity>
                </View>
            )}

            <TouchableOpacity 
                style={[styles.stopButton, { backgroundColor: '#FFEBEE' }]} 
                onPress={handleStopServer}
            >
                <Text style={[styles.stopButtonText, { color: '#D32F2F' }]}>Stop Server</Text>
            </TouchableOpacity>

        </KeyboardAvoidingView>
      </View>
    </View>
  );
};

const InstructionItem = ({ number, text, colors }: any) => (
    <View style={styles.instructionItem}>
        <View style={[styles.instructionNumber, { backgroundColor: colors.border }]}>
            <Text style={[styles.numberText, { color: colors.text }]}>{number}</Text>
        </View>
        <Text style={[styles.instructionText, { color: colors.text }]}>{text}</Text>
    </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerWrapper: {
    height: 110,
    backgroundColor: 'transparent',
    zIndex: 10,
  },
  headerGradient: {
    ...StyleSheet.absoluteFillObject,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 50 : 20,
    paddingBottom: 15,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFF',
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  contentContainer: {
    flex: 1,
    padding: 20,
    paddingBottom: 30
  },
  mainCard: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  illustrationContainer: {
      marginBottom: 32,
      alignItems: 'center',
      justifyContent: 'center',
      height: 160,
  },
  iconCircle: {
      width: 120,
      height: 120,
      borderRadius: 60,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
  },
  pulseRing: {
      position: 'absolute',
      width: 160,
      height: 160,
      borderRadius: 80,
      backgroundColor: 'rgba(33, 150, 243, 0.1)',
      zIndex: 1,
  },
  statusContainer: {
      alignItems: 'center',
      marginBottom: 32,
  },
  statusTitle: {
      fontSize: 22,
      fontWeight: '700',
      marginBottom: 8,
  },
  statusSubtitle: {
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 20,
      maxWidth: '80%'
  },
  urlCard: {
      width: '100%',
      padding: 20,
      borderRadius: 16,
      alignItems: 'center',
      marginBottom: 32,
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.05)'
  },
  urlLabel: {
      fontSize: 12,
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 1,
      fontWeight: '600'
  },
  urlText: {
      fontSize: 24,
      fontWeight: '700',
      marginBottom: 8,
  },
  copyButton: {
      padding: 8,
  },
  instructionsContainer: {
      width: '100%',
      marginBottom: 32,
  },
  instructionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
  },
  instructionNumber: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
  },
  numberText: {
      fontSize: 14,
      fontWeight: '700',
  },
  instructionText: {
      fontSize: 15,
      fontWeight: '500',
  },
  stopButton: {
      paddingVertical: 16,
      paddingHorizontal: 32,
      borderRadius: 30,
      width: '100%',
      alignItems: 'center'
  },
  stopButtonText: {
      fontSize: 16,
      fontWeight: '700'
  }
});

export default PCConnectionScreen;
