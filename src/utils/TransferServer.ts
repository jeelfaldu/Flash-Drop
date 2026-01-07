import TcpSocket from 'react-native-tcp-socket';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import { saveHistoryItem } from './HistoryService';

export type ServerStatus = {
  type: 'client_connected' | 'progress' | 'complete' | 'error';
  clientAddress?: string;
  fileProgress?: {
    name: string;
    percent: number;
    sent: number;
    total: number;
  };
  message?: string;
}

export class TransferServer {
    server: any;
    filesToSend: any[] = [];
  statusCallback?: (status: ServerStatus) => void;
  private connectedClients = new Set<string>();
    
  start(port = 8888, files: any[], onStatus?: (status: ServerStatus) => void) {
        this.filesToSend = files;
    this.statusCallback = onStatus;
        
        console.log(`[TransferServer] Starting on 0.0.0.0:${port}`);
        
        this.server = TcpSocket.createServer((socket) => {
          const address: any = socket.address();
          const clientIp = typeof address === 'string' ? address : address.address;
          console.log('[TransferServer] Client connected from:', clientIp);

          if (this.statusCallback && !this.connectedClients.has(clientIp)) {
            this.connectedClients.add(clientIp);
            this.statusCallback({
              type: 'client_connected',
              clientAddress: clientIp
            });
            // Clear from set after some time if we want to allow re-entry, 
            // but for a single session this is safer.
          }
            
            socket.on('data', async (data) => {
                const msg = data.toString().trim();
                console.log('Received:', msg);
                
                if (msg === 'GET_METADATA') {
                  const metadata = JSON.stringify(this.filesToSend.map(f => {
                    let numericSize = 0;
                    if (typeof f.rawSize === 'number') numericSize = f.rawSize;
                    else if (typeof f.size === 'number') numericSize = f.size;
                    else if (typeof f.size === 'string') numericSize = parseFloat(f.size.replace(/[^0-9.]/g, '')) * (f.size.includes('GB') ? 1024 * 1024 * 1024 : f.size.includes('MB') ? 1024 * 1024 : f.size.includes('KB') ? 1024 : 1);

                    return {
                        name: f.name,
                        type: f.type,
                      size: numericSize,
                      uri: f.uri
                    };
                  }));
                    socket.write(metadata + "\n<EOF>\n");
                } 
                else if (msg.startsWith('GET_FILE:')) {
                    const cleanName = msg.replace('GET_FILE:', '').trim();
                    await this.sendFile(socket, cleanName);
                }
            });

            socket.on('error', (error) => {
                console.log('Server Socket Error:', error);
              if (this.statusCallback) {
                this.statusCallback({ type: 'error', message: error.message });
              }
            });
        }).listen({ port, host: '0.0.0.0' }, () => {
            console.log('Transfer Server running on port', port);
        });
        
        return { port };
    }

    updateFiles(files: any[]) {
        this.filesToSend = files;
        console.log('[TransferServer] Files updated:', files.length);
    }

    async sendFile(socket: any, fileName: string) {
        const file = this.filesToSend.find(f => f.name === fileName);
        if (!file) {
          console.log(`[TransferServer] File not found: ${fileName}`);
            return;
        }

        try {
          console.log(`[TransferServer] Sending file: ${file.name}`);
            
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

              // Only report progress every 5% or at completion to reduce overhead
              if (this.statusCallback && (currentPercent >= lastReportedPercent + 5 || offset >= fileSize)) {
                lastReportedPercent = currentPercent;
                this.statusCallback({
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
            console.log(`[TransferServer] Sent ${fileName}`);
            
            saveHistoryItem({
                fileName: file.name,
              fileSize: fileSize,
                type: file.type || 'unknown',
                role: 'sent',
                status: 'success'
            });

        } catch (e: any) {
            console.error('Send failed', e);
          if (this.statusCallback) {
            this.statusCallback({ type: 'error', message: e.message });
          }
        }
    }

    stop() {
        if (this.server) {
            this.server.close(); 
            this.server = null;
        }
      this.connectedClients.clear();
    }
}

export default new TransferServer();

