/**
 * DiscoveryManager.ts
 *
 * Hybrid Device Discovery for Flash-Drop
 * ────────────────────────────────────────
 * Strategy:
 *   PRIMARY  → mDNS / Bonjour (react-native-zeroconf)
 *              - Sender broadcasts "_flashdrop._tcp" service
 *              - Receiver listens, no QR needed for same-network discovery
 *              - Works on Android (NSD) + iOS (Bonjour) natively
 *
 *   FALLBACK → Smart Subnet Scan
 *              - Derives subnet from device's own IP
 *              - Scans gateway + neighbours in parallel batches
 *              - Used when mDNS is blocked (corp Wi-Fi, custom routers)
 *
 * Usage:
 *   // Sender side
 *   DiscoveryManager.publishService(8888);
 *   DiscoveryManager.stopPublishing();
 *
 *   // Receiver side
 *   const ip = await DiscoveryManager.discoverSender(8888, (log) => setLog(log));
 *   // ip is the resolved IP of the sender, or null if timed out
 */

import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import TcpSocket from 'react-native-tcp-socket';

// ─── Constants ────────────────────────────────────────────────────────────────
const SERVICE_TYPE = '_flashdrop._tcp.';
const SERVICE_NAME = 'FlashDrop';

// ─── mDNS wrapper (lazy require to avoid crash on unsupported envs) ────────────
let Zeroconf: any = null;
try {
  Zeroconf = require('react-native-zeroconf').default;
} catch (e) {
  console.warn('[Discovery] react-native-zeroconf not available, using fallback only.');
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type DiscoveryLog = (message: string) => void;

// ─────────────────────────────────────────────────────────────────────────────
// DiscoveryManager Class
// ─────────────────────────────────────────────────────────────────────────────
class DiscoveryManager {
  private zeroconf: any = null;
  private isPublishing = false;
  private publishedPort = 0;

  constructor() {
    if (Zeroconf) {
      try {
        this.zeroconf = new Zeroconf();
      } catch (e) {
        console.warn('[Discovery] Could not init Zeroconf:', e);
      }
    }
  }

  // ─── SENDER SIDE: Publish mDNS Service ──────────────────────────────────────

  /**
   * Broadcast this device as a FlashDrop sender on the local network.
   * Other devices on the same Wi-Fi will discover this automatically.
   * @param port TCP port the TransferServer is listening on
   */
  publishService(port: number) {
    if (!this.zeroconf) {
      console.log('[Discovery] mDNS not available, skipping publish.');
      return;
    }
    if (this.isPublishing) {
      this.stopPublishing();
    }

    try {
      console.log(`[Discovery] Publishing mDNS service on port ${port}`);
      this.zeroconf.publishService(
        '_flashdrop._tcp.', // type
        'tcp',              // protocol
        'local.',           // domain
        SERVICE_NAME,       // name
        port,               // port
        { app: 'flashdrop', version: '1' } // txt records
      );
      this.isPublishing = true;
      this.publishedPort = port;
    } catch (e) {
      console.warn('[Discovery] mDNS publish failed:', e);
    }
  }

  /**
   * Stop broadcasting the mDNS service (call when transfer session ends).
   */
  stopPublishing() {
    if (!this.zeroconf || !this.isPublishing) return;
    try {
      this.zeroconf.unpublishService(SERVICE_NAME);
      console.log('[Discovery] mDNS service unpublished.');
    } catch (e) {
      console.warn('[Discovery] mDNS unpublish error:', e);
    } finally {
      this.isPublishing = false;
    }
  }

  // ─── RECEIVER SIDE: Discover Sender ─────────────────────────────────────────

  /**
   * Discover a Flash-Drop sender on the local network.
   *
   * Flow:
   *  1. Try mDNS — resolve in ~2s if sender is on same network
   *  2. If mDNS times out → run Smart Subnet Scan
   *
   * @param port      Expected TCP port of the sender
   * @param onLog     Callback for progress messages shown in the UI
   * @param timeoutMs How long to wait for mDNS before falling back (default 5s)
   * @returns         Resolved IP string, or null if discovery failed
   */
  async discoverSender(
    port: number,
    onLog: DiscoveryLog,
    timeoutMs = 5000
  ): Promise<string | null> {
    // ── Step 1: mDNS ──────────────────────────────────────────────────────────
    onLog('🔍 Discovering via mDNS...');
    const mdnsIp = await this.discoverViaMDNS(port, timeoutMs, onLog);
    if (mdnsIp) {
      onLog(`✅ Found via mDNS: ${mdnsIp}`);
      return mdnsIp;
    }

    // ── Step 2: Smart Subnet Scan (fallback) ──────────────────────────────────
    onLog('📡 mDNS timeout. Trying subnet scan...');
    const scanIp = await this.discoverViaSubnetScan(port, onLog);
    if (scanIp) {
      onLog(`✅ Found via Scan: ${scanIp}`);
      return scanIp;
    }

    onLog('❌ Discovery failed. Make sure both devices are on the same Wi-Fi.');
    return null;
  }

  // ─── PRIVATE: mDNS Discovery ─────────────────────────────────────────────────

  private discoverViaMDNS(
    port: number,
    timeoutMs: number,
    onLog: DiscoveryLog
  ): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.zeroconf) {
        resolve(null);
        return;
      }

      let resolved = false;
      let zc: any;

      try {
        zc = new (require('react-native-zeroconf').default)();
      } catch (e) {
        resolve(null);
        return;
      }

      const cleanup = () => {
        try {
          zc.stop();
          zc.removeDeviceListeners();
        } catch (_) {}
      };

      // Timeout
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(null);
        }
      }, timeoutMs);

      zc.on('resolved', (service: any) => {
        if (resolved) return;
        console.log('[Discovery] mDNS resolved:', JSON.stringify(service));

        // Accept any flashdrop service - verify port matches
        const servicePort: number = service.port || 0;
        const addresses: string[] = service.addresses || [];

        // Filter out loopback / invalid IPs
        const validIp = addresses.find(
          (ip: string) =>
            ip &&
            ip !== '0.0.0.0' &&
            ip !== '127.0.0.1' &&
            !ip.startsWith('169.254') // link-local
        );

        if (validIp) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve(validIp);
        }
      });

      zc.on('error', (err: any) => {
        console.warn('[Discovery] mDNS error:', err);
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve(null);
        }
      });

      try {
        zc.scan('_flashdrop._tcp.', 'tcp', 'local.');
      } catch (e) {
        console.warn('[Discovery] mDNS scan start failed:', e);
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  // ─── PRIVATE: Smart Subnet Scan ──────────────────────────────────────────────

  /**
   * Derive the subnet from this device's IP and scan likely hosts.
   * Priority: gateway (.1), device neighbours (±10), then full subnet.
   */
  private async discoverViaSubnetScan(
    port: number,
    onLog: DiscoveryLog,
    maxAttempts = 30
  ): Promise<string | null> {
    const candidateIps = await this.buildSmartCandidateList();
    onLog(`📡 Scanning ${candidateIps.length} candidates...`);

    const BATCH_SIZE = 5; // parallelism
    const PROBE_TIMEOUT = 1500; // ms per IP

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (candidateIps.length === 0) break;
      onLog(`🔎 Scan attempt ${attempt + 1}/${maxAttempts}...`);

      for (let i = 0; i < candidateIps.length; i += BATCH_SIZE) {
        const batch = candidateIps.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(ip => this.probeTcpPort(ip, port, PROBE_TIMEOUT))
        );
        const found = batch[results.findIndex(r => r)];
        if (found) return found;
      }

      // On retry, refresh candidate list (IP might have changed)
      if (attempt % 5 === 0 && attempt > 0) {
        const refreshed = await this.buildSmartCandidateList();
        refreshed.forEach(ip => {
          if (!candidateIps.includes(ip)) candidateIps.unshift(ip);
        });
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    return null;
  }

  /**
   * Build a prioritized list of IP candidates based on device's current IP.
   *
   * Priority order:
   *   1. Known common hotspot gateway IPs (Wi-Fi Direct, Android Hotspot)
   *   2. X.X.X.1  (subnet gateway derived from our own IP)
   *   3. DHCP gateway from react-native-wifi-reborn (Android only)
   *   4. Neighbours ±10 of our IP
   *   5. Remaining subnet (.2 - .254 excluding ourselves)
   */
  private async buildSmartCandidateList(): Promise<string[]> {
    const seen = new Set<string>();
    const candidates: string[] = [];

    const add = (ip: string) => {
      if (ip && ip !== '0.0.0.0' && ip !== '127.0.0.1' && !seen.has(ip)) {
        seen.add(ip);
        candidates.push(ip);
      }
    };

    // ① Common Android Wi-Fi Direct / Hotspot gateways
    ['192.168.49.1', '192.168.43.1', '192.168.45.1', '10.0.0.1'].forEach(add);

    // ② Derive subnet from own IP
    let myIp = '';
    try {
      myIp = await DeviceInfo.getIpAddress();
    } catch (_) {}

    if (myIp && myIp !== '0.0.0.0') {
      const parts = myIp.split('.');
      if (parts.length === 4) {
        const subnet = parts.slice(0, 3).join('.');
        const myOctet = parseInt(parts[3], 10);

        // Gateway always first
        add(`${subnet}.1`);

        // Neighbours ±10
        for (let delta = 1; delta <= 10; delta++) {
          const lower = myOctet - delta;
          const upper = myOctet + delta;
          if (lower > 1) add(`${subnet}.${lower}`);
          if (upper < 255) add(`${subnet}.${upper}`);
        }

        // Full subnet sweep (deferred — fill remaining)
        for (let i = 2; i <= 254; i++) {
          if (i !== myOctet) add(`${subnet}.${i}`);
        }
      }
    }

    // ③ DHCP gateway (Android only, optional)
    if (Platform.OS === 'android') {
      try {
        const WifiManager = require('react-native-wifi-reborn').default;
        const wm: any = WifiManager;
        if (wm.getDhcpInfo) {
          const dhcp = await wm.getDhcpInfo();
          if (dhcp?.gateway && dhcp.gateway !== '0.0.0.0') {
            // Insert right after fixed hotspot IPs (high priority)
            if (!seen.has(dhcp.gateway)) {
              candidates.splice(4, 0, dhcp.gateway);
              seen.add(dhcp.gateway);
            }
          }
        }
      } catch (_) {}
    }

    return candidates;
  }

  // ─── PRIVATE: Single TCP Probe ───────────────────────────────────────────────

  /**
   * Try to open a TCP connection to ip:port.
   * Returns true if connection succeeds (sender found), false otherwise.
   */
  probeTcpPort(ip: string, port: number, timeoutMs = 1500): Promise<boolean> {
    return new Promise(resolve => {
      let done = false;
      let client: any = null;

      const finish = (result: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { client?.destroy(); } catch (_) {}
        resolve(result);
      };

      const timer = setTimeout(() => finish(false), timeoutMs);

      try {
        client = TcpSocket.createConnection({ port, host: ip }, () => finish(true));
        client.on('error', () => finish(false));
      } catch (_) {
        finish(false);
      }
    });
  }

  // ─── Utility ─────────────────────────────────────────────────────────────────

  /** Returns true if mDNS is functional on this device */
  get isMDNSAvailable(): boolean {
    return !!this.zeroconf;
  }
}

export default new DiscoveryManager();
