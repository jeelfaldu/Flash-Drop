import { Platform } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import { saveHistoryItem } from './HistoryService';
import WifiManager from 'react-native-wifi-reborn';

export type TransferStatus = {
    type: 'log' | 'progress' | 'complete' | 'connection';
    message?: string;
    fileProgress?: {
        name: string;
        percent: number;
        received: number;
        total: number;
    };
    connected: boolean;
    files?: any[];
}

export class TransferClient {
    private isTransferring = false;
    private shouldStop = false;
    private downloadedFiles = new Set<string>();
  public onStatus?: (status: TransferStatus) => void;
    
  start(port = 8888, saveDir: string, specificIp?: string) {
        this.shouldStop = false;
    this.initConnection(port, saveDir, specificIp);
    }

    stop() {
        this.shouldStop = true;
        this.isTransferring = false;
    }

  private reportStatus(status: TransferStatus) {
    if (this.onStatus) {
      this.onStatus(status);
    }
  }

  private async initConnection(port: number, saveDir: string, specificIp?: string) {
    this.reportStatus({ type: 'log', message: "Initializing Network...", connected: false });
    await new Promise(r => setTimeout(r, 1000));

    if (Platform.OS === 'android') {
        try { await WifiManager.forceWifiUsage(true); } catch(e) {}
    }

    const possibleIps = new Set<string>();
    if (specificIp) {
      possibleIps.add(specificIp);
    }

    try {
      const wm: any = WifiManager;
      if (typeof wm.getDhcpInfo === 'function') {
        const dhcp = await wm.getDhcpInfo();
        if (dhcp && dhcp.gateway) {
          possibleIps.add(dhcp.gateway);
        }
      }
    } catch (e) { }

    possibleIps.add('192.168.49.1');
    possibleIps.add('192.168.43.1');
    possibleIps.add('192.168.1.1');

    const ipList = Array.from(possibleIps);
    this.findSenderAndConnect(ipList, port, saveDir, 1);
  }

  private async findSenderAndConnect(ips: string[], port: number, saveDir: string, attempt: number) {
        if (this.shouldStop) return;
        if (attempt > 15) {
          this.reportStatus({ type: 'log', message: "Discovery timeout. Check connection.", connected: false });
            return;
        }

    this.reportStatus({ type: 'log', message: `Connecting (Attempt ${attempt})...`, connected: false });
        
        for (const ip of ips) {
          const success = await this.trySingleIp(ip, port, saveDir);
            if (success) {
                // Connection found! Start persistent loop
              this.persistentLoop(ip, port, saveDir);
                return;
            }
        }

        setTimeout(() => {
          this.findSenderAndConnect(ips, port, saveDir, attempt + 1);
        }, 2000);
    }

  private trySingleIp(ip: string, port: number, saveDir: string): Promise<boolean> {
        return new Promise((resolve) => {
            let resolved = false;
            const client = TcpSocket.createConnection({ port, host: ip }, () => {
                if (resolved) return;
                resolved = true;
                client.destroy();
                resolve(true);
            });

            client.on('error', () => {
                if (resolved) return;
                resolve(false);
            });

            setTimeout(() => {
                if (!resolved) {
                    client.destroy();
                    resolved = true;
                    resolve(false);
                }
            }, 2000);
        });
    }

  private async persistentLoop(ip: string, port: number, saveDir: string) {
    this.reportStatus({ type: 'connection', message: "Connected to Sender", connected: true });
        
        while (!this.shouldStop) {
            if (!this.isTransferring) {
                try {
                    const files = await this.fetchMetadata(ip, port);
                    if (files && files.length > 0) {
                        const newFiles = files.filter((f: any) => !this.downloadedFiles.has(f.name + f.size));
                        if (newFiles.length > 0) {
                            this.isTransferring = true;
                          this.reportStatus({ type: 'log', message: `Found ${newFiles.length} new files`, connected: true, files: files });
                          await this.downloadAll(newFiles, ip, port, saveDir);
                            this.isTransferring = false;
                        }
                    }
                } catch (e) {
                    console.log("Metadata poll failed", e);
                    // Maybe connection lost?
                }
            }
            await new Promise(r => setTimeout(r, 3000)); // Poll every 3 seconds
        }
    }

    private fetchMetadata(ip: string, port: number): Promise<any[]> {
        return new Promise((resolve, reject) => {
            let activeBuffer = '';
            const client = TcpSocket.createConnection({ port, host: ip }, () => {
                client.write('GET_METADATA');
            });

            client.on('data', (data) => {
                activeBuffer += data.toString();
                if (activeBuffer.includes('<EOF>')) {
                    const [jsonStr] = activeBuffer.split('<EOF>');
                    client.destroy();
                    try {
                        resolve(JSON.parse(jsonStr));
                    } catch(e) { reject(e); }
                }
            });

            client.on('error', reject);
            setTimeout(() => { client.destroy(); reject("Metadata timeout"); }, 5000);
        });
    }
    
  async downloadAll(files: any[], ip: string, port: number, saveDir: string) {
        try {
            if (!(await RNFS.exists(saveDir))) {
                await RNFS.mkdir(saveDir);
            }
        } catch(e) {}
        
        for (const file of files) {
            try {
              await this.downloadFile(file, ip, port, saveDir);
                this.downloadedFiles.add(file.name + file.size);
            } catch (e: any) {
              this.reportStatus({ type: 'log', message: `Error: ${file.name} - ${e.message}`, connected: true });
            }
        }
    this.reportStatus({ type: 'complete', message: "Batch completed", connected: true });
    }

  downloadFile(file: any, ip: string, port: number, saveDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const destPath = `${saveDir}/${file.name}`;
            RNFS.unlink(destPath).catch(() => {});
            
            const client = TcpSocket.createConnection({ port, host: ip }, () => {
                client.write(`GET_FILE:${file.name}`);
            });
            
            let received = 0;
            const total = file.size;
          let lastReportedPercent = 0;
            
            client.on('data', async (data) => {
                try {
                     const b64 = (typeof data === 'string') 
                        ? Buffer.from(data).toString('base64') 
                        : data.toString('base64');
                        
                     await RNFS.appendFile(destPath, b64, 'base64');
                     received += (typeof data === 'string' ? data.length : data.byteLength);
                     
                  const currentPercent = Math.floor((received / total) * 100);

                  // Only report progress every 5% or at completion to reduce overhead
                  if (currentPercent >= lastReportedPercent + 5 || received >= total) {
                    lastReportedPercent = currentPercent;
                    this.reportStatus({
                      type: 'progress',
                      connected: true,
                      fileProgress: {
                        name: file.name,
                             percent: currentPercent,
                             received,
                             total
                           }
                         });
                     }
                     
                     if (received >= total) {
                         client.destroy();
                         saveHistoryItem({
                            fileName: file.name, fileSize: file.size,
                            type: file.type || 'unknown', role: 'received', status: 'success'
                         });
                         resolve();
                     }
                } catch(e) {
                    client.destroy();
                    reject(e);
                }
            });
            
            client.on('error', (e) => {
                client.destroy();
                reject(e);
            });
        });
    }
}

export default new TransferClient();


