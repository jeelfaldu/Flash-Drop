import TcpSocket from 'react-native-tcp-socket';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import { saveHistoryItem } from './HistoryService';

// Singleton class to manage both server and client capabilities
export class BidirectionalTransferManager {
    private static instance: BidirectionalTransferManager;
    private server: any = null;
    private client: any = null;
    private isServerMode: boolean = false;
    private connectedPeerIp: string | null = null;
    private filesToSend: any[] = [];
    public onStatus?: (status: any) => void;

    private constructor() {}

    static getInstance(): BidirectionalTransferManager {
        if (!BidirectionalTransferManager.instance) {
            BidirectionalTransferManager.instance = new BidirectionalTransferManager();
        }
        return BidirectionalTransferManager.instance;
    }

    // Start as server (original sender)
    startAsServer(port: number, files: any[], onStatus?: (status: any) => void) {
        this.isServerMode = true;
        this.filesToSend = files;
        this.onStatus = onStatus;

        console.log('[BiTransfer] Starting as SERVER on port', port);

        this.server = TcpSocket.createServer((socket) => {
            const address: any = socket.address();
            const clientIp = typeof address === 'string' ? address : address.address;
            this.connectedPeerIp = clientIp;
            
            console.log('[BiTransfer] Client connected:', clientIp);
            
            if (this.onStatus) {
                this.onStatus({ type: 'peer_connected', peerIp: clientIp });
            }

            this.handleSocket(socket);
        }).listen({ port, host: '0.0.0.0' });
    }

    // Start as client (original receiver)
    startAsClient(serverIp: string, port: number, downloadDir: string, onStatus?: (status: any) => void) {
        this.isServerMode = false;
        this.connectedPeerIp = serverIp;
        this.onStatus = onStatus;

        console.log('[BiTransfer] Starting as CLIENT, connecting to', serverIp);

        // Start polling for metadata
        this.pollMetadata(serverIp, port, downloadDir);
    }

    // Handle incoming socket connections/messages
    private handleSocket(socket: any) {
        socket.on('data', async (data: any) => {
            const msg = data.toString().trim();
            console.log('[BiTransfer] Received:', msg);

            if (msg === 'GET_METADATA') {
                const metadata = JSON.stringify(this.filesToSend.map(f => {
                    let numericSize = 0;
                    if (typeof f.rawSize === 'number') numericSize = f.rawSize;
                    else if (typeof f.size === 'number') numericSize = f.size;
                    
                    return {
                        name: f.name,
                        type: f.type,
                        size: numericSize,
                        uri: f.uri
                    };
                }));
                socket.write(metadata + "\n<EOF>\n");
            } else if (msg.startsWith('GET_FILE:')) {
                const fileName = msg.replace('GET_FILE:', '').trim();
                await this.sendFile(socket, fileName);
            }
        });

        socket.on('error', (error: any) => {
            console.log('[BiTransfer] Socket error:', error);
        });
    }

    // Send file to peer
    private async sendFile(socket: any, fileName: string) {
        const file = this.filesToSend.find(f => f.name === fileName);
        if (!file) {
            console.log('[BiTransfer] File not found:', fileName);
            return;
        }

        try {
            const chunkSize = 1024 * 64;
            let offset = 0;
            const fileSize = (typeof file.rawSize === 'number' ? file.rawSize : file.size);
            let lastReportedPercent = 0;

            while (offset < fileSize) {
                const chunkBase64 = await RNFS.read(file.uri, chunkSize, offset, 'base64');
                const buffer = Buffer.from(chunkBase64, 'base64');
                socket.write(buffer);
                offset += buffer.length;

                const currentPercent = Math.floor((offset / fileSize) * 100);
                
                if (this.onStatus && (currentPercent >= lastReportedPercent + 5 || offset >= fileSize)) {
                    lastReportedPercent = currentPercent;
                    this.onStatus({
                        type: 'progress',
                        fileProgress: {
                            name: file.name,
                            percent: currentPercent,
                            sent: offset,
                            total: fileSize
                        }
                    });
                }

                if (offset % (chunkSize * 10) === 0) {
                    await new Promise(r => setTimeout(r, 1));
                }
            }

            saveHistoryItem({
                fileName: file.name,
                fileSize: fileSize,
                type: file.type || 'unknown',
                role: 'sent',
                status: 'success'
            });
        } catch (e: any) {
            console.error('[BiTransfer] Send failed', e);
        }
    }

    // Poll for metadata from peer
    private async pollMetadata(ip: string, port: number, downloadDir: string) {
        // Implementation similar to TransferClient
        // This allows the receiver to also download files
    }

    // Update files to send
    updateFiles(files: any[]) {
        this.filesToSend = files;
        console.log('[BiTransfer] Files updated:', files.length);
    }

    // Get peer IP
    getPeerIp(): string | null {
        return this.connectedPeerIp;
    }

    // Stop all connections
    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
        this.connectedPeerIp = null;
    }
}

export default BidirectionalTransferManager.getInstance();
