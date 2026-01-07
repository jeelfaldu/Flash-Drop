import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, StatusBar, SafeAreaView } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme } from '../theme/ThemeContext';

const { width, height } = Dimensions.get('window');

const HomeScreen = ({ navigation }: any) => {
  const { theme, isDark, mode, setMode } = useTheme();

  const toggleTheme = () => {
    setMode(isDark ? 'light' : 'dark');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Dynamic Purple Header Background */}
      <View style={styles.headerWrapper}>
        <LinearGradient
          colors={isDark ? ['#1E1E1E', '#121212', '#000000'] : ['#6200EA', '#7C4DFF', '#B388FF']}
          style={styles.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <SafeAreaView>
          <View style={styles.headerContent}>
            <Text style={styles.title}>Flash Drop</Text>
            <View style={styles.headerIcons}>
              <TouchableOpacity onPress={toggleTheme}>
                <Icon name={isDark ? "weather-sunny" : "weather-night"} size={28} color="#FFF" style={styles.headerIcon} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('History')}>
                <Icon name="history" size={28} color="#FFF" style={styles.headerIcon} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { }}>
                <Icon name="cog-outline" size={28} color="#FFF" style={styles.headerIcon} />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>

      {/* Main Action Card */}
      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>File Transfer</Text>
          <Text style={[styles.cardSubtitle, { color: theme.subtext }]}>Share files, images, videos & documents</Text>

          <View style={styles.buttonRow}>
            {/* Send Button */}
            <TouchableOpacity 
              style={[styles.actionButton, styles.sendButton, { backgroundColor: isDark ? '#1E1E1E' : '#E3F2FD', borderColor: isDark ? '#333' : '#BBDEFB' }]}
              onPress={() => navigation.navigate('Send')}
              activeOpacity={0.7}
            >
              <View style={[styles.iconContainer, styles.sendIconContainer, { backgroundColor: isDark ? '#242424' : '#E3F2FD' }]}>
                <Icon name="send" size={24} color={isDark ? theme.primary : "#2196F3"} />
              </View>
              <View style={styles.buttonTextContainer}>
                <Text style={[styles.buttonTitle, { color: theme.text }]}>Send File</Text>
                <Text style={[styles.buttonLabel, { color: theme.subtext }]}>Import</Text>
              </View>
            </TouchableOpacity>

            {/* Receive Button */}
            <TouchableOpacity 
              style={[styles.actionButton, styles.receiveButton, { backgroundColor: isDark ? '#1E1E1E' : '#FFF3E0', borderColor: isDark ? '#333' : '#FFE0B2' }]}
              onPress={() => navigation.navigate('Receive')}
              activeOpacity={0.7}
            >
              <View style={[styles.iconContainer, styles.receiveIconContainer, { backgroundColor: isDark ? '#242424' : '#FFF3E0' }]}>
                <Icon name="folder-download" size={24} color={isDark ? theme.primary : "#FF9800"} />
              </View>
              <View style={styles.buttonTextContainer}>
                <Text style={[styles.buttonTitle, { color: theme.text }]}>Receive</Text>
                <Text style={[styles.buttonLabel, { color: theme.subtext }]}>Export</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Decorative Gradient Overlay (Subtle) */}
      <View style={styles.bottomSection}>
        {/* Placeholder for future features or history list */}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FE',
  },
  headerWrapper: {
    height: height * 0.28,
    width: '100%',
    position: 'absolute',
    top: 0,
  },
  headerGradient: {
    ...StyleSheet.absoluteFillObject,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 25,
    paddingTop: 45,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  headerIcons: {
    flexDirection: 'row',
  },
  headerIcon: {
    marginLeft: 15,
  },
  content: {
    marginTop: height * 0.16,
    paddingHorizontal: 20,
    zIndex: 1,
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#6200EA',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    width: '48%',
    borderWidth: 1,
  },
  sendButton: {
    backgroundColor: '#E3F2FD',
    borderColor: '#BBDEFB',
  },
  receiveButton: {
    backgroundColor: '#FFF3E0',
    borderColor: '#FFE0B2',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF',
  },
  sendIconContainer: {
    backgroundColor: '#E3F2FD',
  },
  receiveIconContainer: {
    backgroundColor: '#FFF3E0',
  },
  buttonTextContainer: {
    marginLeft: 10,
    flex: 1,
  },
  buttonTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  buttonLabel: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  bottomSection: {
    flex: 1,
    marginTop: 20,
  }
});

export default HomeScreen;

