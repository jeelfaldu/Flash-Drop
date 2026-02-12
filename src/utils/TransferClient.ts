import { Platform } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import DeviceInfo from 'react-native-device-info';
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
    private isProbing = false;
    private downloadedFiles = new Set<string>();
    public onStatus?: (status: TransferStatus) => void;
    
    start(port = 8888, saveDir: string, specificIp?: string) {
        console.log(`[TransferClient] Starting client on port ${port}...`);
        this.shouldStop = false;
        this.isTransferring = false;
        this.isProbing = false;
        this.initConnection(port, saveDir, specificIp);
    }

    stop() {
        console.log('[TransferClient] Stopping client...');
        this.shouldStop = true;
        this.isTransferring = false;
        this.isProbing = false;
    }

    private reportStatus(status: TransferStatus) {
        if (this.onStatus) {
            this.onStatus(status);
        }
    }

    private async initConnection(port: number, saveDir: string, specificIp?: string) {
        if (this.isProbing || this.shouldStop) return;
        this.isProbing = true;

        this.reportStatus({ type: 'log', message: "Discovery started...", connected: false });

        const possibleIps = new Set<string>();
        if (specificIp && specificIp !== '0.0.0.0' && specificIp !== '127.0.0.1') {
            possibleIps.add(specificIp);
        }

        possibleIps.add('192.168.49.1'); 
        possibleIps.add('192.168.43.1'); 
        possibleIps.add('192.168.45.1'); 
        possibleIps.add('10.0.0.1');

        this.findSenderAndConnect(possibleIps, port, saveDir, 1);
    }

    private async findSenderAndConnect(ipSet: Set<string>, port: number, saveDir: string, attempt: number) {
        if (this.shouldStop) { this.isProbing = false; return; }
        
        if (attempt > 40) { 
            this.reportStatus({ type: 'log', message: "Discovery Timeout. Restart both apps.", connected: false });
            this.isProbing = false;
            return;
        }

        if (Platform.OS === 'android') {
            try { await WifiManager.forceWifiUsage(true); } catch(e) {}
        }

        if (attempt % 5 === 2) {
            try {
                const wm: any = WifiManager;
                const dhcp = await wm.getDhcpInfo();
                if (dhcp?.gateway && dhcp.gateway !== '0.0.0.0') ipSet.add(dhcp.gateway);
            } catch (e) {}

            try {
                const myIp = await DeviceInfo.getIpAddress();
                if (myIp && myIp.includes('.') && myIp !== '0.0.0.0') {
                    const parts = myIp.split('.');
                    parts[3] = '1';
                    ipSet.add(parts.join('.'));
                }
            } catch (e) {}
        }

        const ips = Array.from(ipSet).filter(ip => ip && ip !== '0.0.0.0').slice(-20); // Keep set reasonable
        this.reportStatus({ type: 'log', message: `Discovery [${attempt}/40]...`, connected: false });

        for (let i = 0; i < ips.length; i += 10) {
            if (this.shouldStop) break;
            const batch = ips.slice(i, i + 10);
            const results = await Promise.all(batch.map(ip => this.trySingleIp(ip, port)));
            const foundIdx = results.findIndex(r => r === true);
            
            if (foundIdx !== -1) {
                const foundIp = batch[foundIdx];
                console.log(`[TransferClient] Found sender at ${foundIp}`);
                this.isProbing = false;
                this.persistentLoop(foundIp, port, saveDir);
                return;
            }
        }

        setTimeout(() => this.findSenderAndConnect(ipSet, port, saveDir, attempt + 1), 1500);
    }

    private async persistentLoop(ip: string, port: number, saveDir: string) {
        this.reportStatus({ type: 'connection', message: "Connected!", connected: true });
        console.log(`[TransferClient] Standing by for files from ${ip}...`);
        
        let failCount = 0;
        while (!this.shouldStop) {
            if (!this.isTransferring) {
                try {
                    const files = await this.fetchMetadata(ip, port);
                    failCount = 0;
                    if (files && files.length > 0) {
                        const newFiles = files.filter((f: any) => !this.downloadedFiles.has(f.name + (f.size || 0)));
                        if (newFiles.length > 0) {
                            console.log(`[TransferClient] New files detected: ${newFiles.length}`);
                            this.isTransferring = true;
                            this.reportStatus({ type: 'log', message: `Found ${newFiles.length} new files`, connected: true, files: files });
                            await this.downloadAll(newFiles, ip, port, saveDir);
                            this.isTransferring = false;
                        }
                    }
                } catch (e) {
                    failCount++;
                    console.log(`[TransferClient] Standing by... (Retry ${failCount})`);
                    if (failCount > 10 && !this.shouldStop) {
                        console.log(`[TransferClient] Connection lost to ${ip}. Re-probing...`);
                        this.reportStatus({ type: 'log', message: "Connection lost. Reconnecting...", connected: false });
                        this.initConnection(port, saveDir, ip);
                        return;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 2500));
        }
    }

    private trySingleIp(ip: string, port: number): Promise<boolean> {
        return new Promise((resolve) => {
            let finished = false;
            let client: any = null;
            const cleanup = () => { if (client) { try { client.destroy(); client = null; } catch(e){} } };

            const timer = setTimeout(() => {
                if (finished) return;
                finished = true;
                cleanup();
                resolve(false);
            }, 3000);

            try {
                client = TcpSocket.createConnection({ port, host: ip }, () => {
                    if (finished) { cleanup(); return; }
                    finished = true;
                    clearTimeout(timer);
                    cleanup();
                    resolve(true);
                });
                client.on('error', () => {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timer);
                    cleanup();
                    resolve(false);
                });
            } catch (e) {
                if (!finished) { finished = true; clearTimeout(timer); cleanup(); resolve(false); }
            }
        });
    }

    private fetchMetadata(ip: string, port: number): Promise<any[]> {
        return new Promise((resolve, reject) => {
            let buffer = '';
            let finished = false;
            let client: any = null;
            const cleanup = () => { if (client) { try { client.destroy(); client = null; } catch(e){} } };

            const timer = setTimeout(() => {
                if (finished) return;
                finished = true; cleanup(); reject(new Error("Metadata Timeout"));
            }, 8000);

            try {
                client = TcpSocket.createConnection({ port, host: ip }, () => {
                    if (!finished) client.write('GET_METADATA');
                });
                client.on('data', (data: any) => {
                    if (finished) return;
                    buffer += data.toString();
                    if (buffer.includes('<EOF>')) {
                        finished = true; clearTimeout(timer);
                        const parts = buffer.split('<EOF>');
                        cleanup();
                        try { resolve(JSON.parse(parts[0].trim())); } catch(e) { reject(e); }
                    }
                });
                client.on('error', (err: any) => {
                    if (finished) return;
                    finished = true; clearTimeout(timer); cleanup(); reject(err);
                });
            } catch (e) { if (!finished) { finished = true; clearTimeout(timer); cleanup(); reject(e); } }
        });
    }

    async downloadAll(files: any[], ip: string, port: number, saveDir: string) {
        if (!(await RNFS.exists(saveDir))) { await RNFS.mkdir(saveDir).catch(()=>{}); }
        for (const file of files) {
            if (this.shouldStop) break;
            try {
                console.log(`[TransferClient] Downloading: ${file.name}`);
                await this.downloadFile(file, ip, port, saveDir);
                this.downloadedFiles.add(file.name + (file.size || 0));
                console.log(`[TransferClient] Finished: ${file.name}`);
            } catch (e) {
                console.error(`[TransferClient] Failed to download ${file.name}:`, e);
            }
        }
        this.reportStatus({ type: 'complete', message: "Batch Completed", connected: true });
    }

    private downloadFile(file: any, ip: string, port: number, saveDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const dest = `${saveDir}/${file.name}`;
            let finished = false;
            let client: any = null;
            let received = 0;
            const total = file.size;
            let lastPct = 0;
            let inactivityTimer: any = null;

            const resetWatchdog = () => {
                if (inactivityTimer) clearTimeout(inactivityTimer);
                inactivityTimer = setTimeout(() => {
                    if (finished) return;
                    console.log(`[TransferClient] Inactivity timeout for ${file.name}`);
                    finished = true; cleanup(); reject(new Error("Transfer Stalled"));
                }, 15000);
            };

            const cleanup = () => { 
                if (inactivityTimer) clearTimeout(inactivityTimer);
                if (client) { try { client.destroy(); client = null; } catch(e){} } 
            };

            RNFS.unlink(dest).catch(() => {});
            resetWatchdog();
            
            try {
                client = TcpSocket.createConnection({ port, host: ip }, () => {
                    if (!finished) client.write(`GET_FILE:${file.name}`);
                });
                client.on('data', async (data: any) => {
                    if (finished) return;
                    resetWatchdog();
                    try {
                        const b64 = (typeof data === 'string') ? Buffer.from(data).toString('base64') : data.toString('base64');
                        await RNFS.appendFile(dest, b64, 'base64');
                        received += (typeof data === 'string' ? data.length : data.byteLength);
                        
                        const pct = Math.floor((received / total) * 100);
                        if (pct >= lastPct + 5 || received >= total) {
                            lastPct = pct;
                            this.reportStatus({ type: 'progress', connected: true, fileProgress: { name: file.name, percent: pct, received, total } });
                        }
                        if (received >= total) {
                            finished = true; cleanup();
                            saveHistoryItem({ fileName: file.name, fileSize: file.size, type: file.type || 'unknown', role: 'received', status: 'success' });
                            resolve();
                        }
                    } catch(e) { finished = true; cleanup(); reject(e); }
                });
                client.on('error', (e: any) => { if (finished) return; finished = true; cleanup(); reject(e); });
            } catch (e) { finished = true; cleanup(); reject(e); }
        });
    }
}

export default new TransferClient();
