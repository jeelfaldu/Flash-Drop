import TcpSocket from 'react-native-tcp-socket';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
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

  updateFiles(newFiles: any[]) {
    // Append only if not already present by name and size to avoid duplicates
    newFiles.forEach(nf => {
      const exists = this.filesToSend.find(f => f.name === nf.name && f.uri === nf.uri);
      if (!exists) {
        this.filesToSend.push(nf);
      }
    });
    console.log(`[TransferServer] Files updated. Total: ${this.filesToSend.length}`);
    }

    async sendFile(socket: any, fileName: string) {
      if (!socket || socket.destroyed) return;

      // Find the requested file. Since we might have duplicates with same name, 
      // normally the receiver should handle this, but here we pick the first match.
        const file = this.filesToSend.find(f => f.name === fileName);
        if (!file) {
          console.log(`[TransferServer] File not found: ${fileName}. Available:`, this.filesToSend.map(f => f.name).join(', '));
          // Send a tiny error response or just close? 
          // For now, let's just return.
          return;
        }

        try {
          console.log(`[TransferServer] Sending file: ${file.name}`);
            
          const chunkSize = 1024 * 64; 
          let offset = 0;

          let fileSize = 0;
          if (typeof file.rawSize === 'number') fileSize = file.rawSize;
          else if (typeof file.size === 'number') fileSize = file.size;

          if (fileSize === 0) {
            try {
              const stat = await RNFS.stat(file.uri);
              fileSize = stat.size;
              console.log(`[TransferServer] Found missing size via stat: ${fileSize}`);
            } catch (e) {
              console.log(`[TransferServer] Warning: File size is 0 and stat failed for ${file.name}`);
            }
          }

          let lastReportedPercent = 0;

          while (offset < fileSize && !socket.destroyed) {
            // Handle content:// URIs on Android by copying to a temp file if needed
            // Note: Better approach is to use a stream, but RNFS chunked read 
            // is more stable for large files if we have a real file path.
            let readPath = file.uri;
            let isTempFile = false;

            if (Platform.OS === 'android' && file.uri.startsWith('content://')) {
              const tempPath = `${RNFS.CachesDirectoryPath}/temp_${file.name}`;
              try {
                // Only copy if it doesn't exist or we want to be fresh
                // For now, let's copy every time to ensure we have the right file
                if (await RNFS.exists(tempPath)) await RNFS.unlink(tempPath);
                await RNFS.copyFile(file.uri, tempPath);
                readPath = tempPath;
                isTempFile = true;
              } catch (copyError) {
                console.error('Failed to copy content URI to temp:', copyError);
                throw copyError;
              }
            }

            try {
              while (offset < fileSize && !socket.destroyed) {
                const chunkBase64 = await RNFS.read(readPath, chunkSize, offset, 'base64');
                const buffer = Buffer.from(chunkBase64, 'base64');

                if (socket.destroyed) break;
                socket.write(buffer);

                offset += buffer.length;

                const currentPercent = Math.floor((offset / fileSize) * 100);

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
            } finally {
              // Cleanup temp file
              if (isTempFile && await RNFS.exists(readPath)) {
                await RNFS.unlink(readPath);
              }
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

