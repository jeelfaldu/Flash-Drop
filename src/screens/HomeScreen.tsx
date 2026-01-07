import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, StatusBar, Image } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width } = Dimensions.get('window');

const HomeScreen = ({ navigation }: any) => {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient colors={['#1A1A1A', '#000']} style={StyleSheet.absoluteFillObject} />

      {/* Header */}
      <View style={styles.header}>
        <View>
            <Text style={styles.brand}>FlashDrop</Text>
            <Text style={styles.tagline}>Future of Sharing</Text>
        </View>
        <TouchableOpacity style={styles.historyBtn} onPress={() => navigation.navigate('History')}>
             <Icon name="history" size={28} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* Main Actions */}
      <View style={styles.actionsContainer}>
         {/* Send Button */}
         <TouchableOpacity 
            style={styles.actionBtn} 
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Send')}
         >
             <LinearGradient 
                colors={['#4CD964', '#2E8B57']} 
                start={{x: 0, y: 0}} end={{x: 1, y: 1}}
                style={styles.gradientCard}
             >
                <Icon name="send" size={40} color="#FFF" />
                <Text style={styles.btnTitle}>SEND</Text>
                <Text style={styles.btnDesc}>Share files instantly</Text>
             </LinearGradient>
         </TouchableOpacity>

         {/* Receive Button */}
         <TouchableOpacity 
            style={styles.actionBtn} 
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Receive')}
         >
             <LinearGradient 
                colors={['#00D1FF', '#005bea']} 
                start={{x: 0, y: 0}} end={{x: 1, y: 1}}
                style={styles.gradientCard}
             >
                <Icon name="download" size={40} color="#FFF" />
                <Text style={styles.btnTitle}>RECEIVE</Text>
                <Text style={styles.btnDesc}>Ready to get files</Text>
             </LinearGradient>
         </TouchableOpacity>
      </View>

      {/* Stats / Info Dashboard */}
      <View style={styles.statsContainer}>
          <Text style={styles.sectionTitle}>Dashboard</Text>
          <View style={styles.statRow}>
              <View style={styles.statCard}>
                  <Icon name="wifi-strength-4" size={24} color="#ffd700" />
                  <Text style={styles.statVal}>Ultra Fast</Text>
                  <Text style={styles.statLabel}>Local Speed</Text>
              </View>
              <View style={styles.statCard}>
                  <Icon name="security" size={24} color="#00D1FF" />
                  <Text style={styles.statVal}>Secure</Text>
                  <Text style={styles.statLabel}>Encryption</Text>
              </View>
              <View style={styles.statCard}>
                  <Icon name="cloud-off-outline" size={24} color="#4CD964" />
                  <Text style={styles.statVal}>Offline</Text>
                  <Text style={styles.statLabel}>No Data</Text>
              </View>
          </View>
      </View>

    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { 
      paddingTop: 60, 
      paddingHorizontal: 25, 
      flexDirection: 'row', 
      justifyContent: 'space-between', 
      alignItems: 'center',
      marginBottom: 40
  },
  brand: { fontSize: 32, fontWeight: '800', color: '#FFF', letterSpacing: 1 },
  tagline: { fontSize: 14, color: '#888', marginTop: 2 },
  historyBtn: { backgroundColor: '#333', padding: 10, borderRadius: 50 },
  
  actionsContainer: { paddingHorizontal: 20 },
  actionBtn: { marginBottom: 20, borderRadius: 24, elevation: 10, shadowColor: '#000', shadowOffset: { width:0, height:4 }, shadowOpacity: 0.3, shadowRadius: 5 },
  gradientCard: { padding: 30, borderRadius: 24, alignItems: 'center', flexDirection: 'column', height: 180, justifyContent: 'center' },
  btnTitle: { fontSize: 28, fontWeight: 'bold', color: '#FFF', marginTop: 10 },
  btnDesc: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 5 },

  statsContainer: { marginTop: 20, paddingHorizontal: 25 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFF', marginBottom: 15 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statCard: { width: '31%', backgroundColor: '#1E1E1E', padding: 15, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  statVal: { color: '#FFF', fontWeight: 'bold', marginTop: 8, fontSize: 13 },
  statLabel: { color: '#666', fontSize: 10, marginTop: 2 },
});

export default HomeScreen;
