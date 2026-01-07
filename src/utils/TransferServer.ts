import TcpSocket from 'react-native-tcp-socket';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import { saveHistoryItem } from './HistoryService';

export class TransferServer {
    server: any;
    filesToSend: any[] = [];
    
    start(port = 8888, files: any[]) {
        this.filesToSend = files;
        
        console.log(`[TransferServer] Starting on 0.0.0.0:${port}`);
        
        this.server = TcpSocket.createServer((socket) => {
            console.log('[TransferServer] Client connected from:', socket.address());
            
            socket.on('data', async (data) => {
                const msg = data.toString().trim();
                console.log('Received:', msg);
                
                if (msg === 'GET_METADATA') {
                    const metadata = JSON.stringify(this.filesToSend.map(f => ({
                        name: f.name,
                        type: f.type,
                        size: f.size,
                        uri: f.uri // URI usage might differ on receiver
                    })));
                    socket.write(metadata + "\n<EOF>\n");
                } 
                else if (msg.startsWith('GET_FILE:')) {
                    const cleanName = msg.replace('GET_FILE:', '').trim();
                    await this.sendFile(socket, cleanName);
                }
            });

            socket.on('error', (error) => {
                console.log('Server Socket Error:', error);
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
            // socket.write("ERROR: File not found"); // Don't write plain error to binary stream
            return;
        }

        try {
            console.log(`[TransferServer] Sending file: ${file.name} (${file.size} bytes)`);
            
            const chunkSize = 1024 * 64; // 64KB for speed
            let offset = 0;
            const fileSize = file.size;

            while (offset < fileSize) {
                const chunkBase64 = await RNFS.read(file.uri, chunkSize, offset, 'base64');
                const buffer = Buffer.from(chunkBase64, 'base64');
                socket.write(buffer);
                offset += chunkSize;
                
                // Throttle slightly to prevent buffer overflow on native bridge
                if (offset % (chunkSize * 10) === 0) {
                    await new Promise(r => setTimeout(r, 1));
                }
            }
            console.log(`[TransferServer] Sent ${fileName}`);
            
            saveHistoryItem({
                fileName: file.name,
                fileSize: file.size,
                type: file.type || 'unknown',
                role: 'sent',
                status: 'success'
            });

        } catch(e) {
            console.error('Send failed', e);
        }
    }

    stop() {
        if (this.server) {
            this.server.close(); 
            this.server = null;
        }
    }
}

export default new TransferServer();
