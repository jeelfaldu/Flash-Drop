// TransferServer.ts (STABLE VERSION WITH PC-TO-MOBILE SUPPORT)

import TcpSocket from 'react-native-tcp-socket';
import ReactNativeBlobUtil from 'react-native-blob-util';
import crypto from 'react-native-quick-crypto';
import { Buffer } from 'buffer';
import { Platform } from 'react-native';

import { saveHistoryItem } from './HistoryService';
import DiscoveryManager from './DiscoveryManager';
import { HTML_CONTENT_BASE64 } from './Constant';

export type ServerContext = 'pc' | 'p2p';
export type ServerStatus = {
  type: 'client_connected' | 'client_disconnected' | 'progress' | 'upload_progress' | 'complete' | 'error' | 'log';
  context?: ServerContext;
  clientAddress?: string;
  fileProgress?: {
    name: string;
    percent: number;
    sent: number;
    total: number;
    speed?: number;
    etaSecs?: number;
  };
  message?: string;
};

class SpeedTracker {
  private t0 = 0;
  private b0 = 0;

  begin(bytes: number) {
    this.t0 = Date.now();
    this.b0 = bytes;
  }

  sample(bytes: number, total: number) {
    const dt = (Date.now() - this.t0) / 1000;
    if (dt < 0.3) return { speed: 0, etaSecs: 0 };

    const speed = Math.round((bytes - this.b0) / dt);
    const remaining = total - bytes;
    const etaSecs = speed > 0 ? Math.round(remaining / speed) : 0;

    return { speed, etaSecs };
  }
}

export class TransferServer {
  server: any = null;
  filesToSend: any[] = [];
  statusCallback?: (status: ServerStatus) => void;
  private statusListeners: Set<(status: ServerStatus) => void> = new Set();

  public addStatusListener(listener: (status: ServerStatus) => void) {
    this.statusListeners.add(listener);
  }

  public removeStatusListener(listener: (status: ServerStatus) => void) {
    this.statusListeners.delete(listener);
  }

  private report(status: ServerStatus) {
    const finalStatus = { ...status, context: this.currentContext || 'p2p' };
    this.statusCallback?.(finalStatus);
    this.statusListeners.forEach(l => l(finalStatus));
  }
  private currentContext: ServerContext | null = null;
  private currentPort = 8888;
  private connectedClients = new Set<string>();
  private peerIp: string | null = null;
  private peerServerPort = 8888;
  private peerRegisteredCb?: (ip: string, port: number) => void;
  private secretKey?: string;

  private tokens = new Map<string, { token: string; ip: string; expires: number }>();

  private getPage() {
    return Buffer.from(HTML_CONTENT_BASE64, 'base64').toString('utf-8');
  }

  private getAuthData(file: any, ip: string) {
    const key = `${file.name}|${file.size}|${ip}`;
    const existing = this.tokens.get(key);
    if (existing && existing.expires > Date.now()) {
      return existing.token;
    }
    const token = crypto.randomBytes(12).toString('hex');
    this.tokens.set(key, {
      token,
      ip,
      expires: Date.now() + 30 * 60 * 1000, // 30 mins
    });
    return token;
  }

  // ================= PIPE =================
  private async pipeToSocket(socket: any, path: string, fileSize: number, start: number, end: number, name: string, tracker: SpeedTracker) {
    if (!socket || socket.destroyed) return;
    const CHUNK = 512 * 1024;
    let offset = start;
    let lastReport = start;
    tracker.begin(start);
    
    return new Promise<void>(async (resolve, reject) => {
      try {
        const stream = await ReactNativeBlobUtil.fs.readStream(path, 'base64', CHUNK, start);
        let isPaused = false;

        socket.on('drain', () => {
          if (isPaused) {
            isPaused = false;
            // Native readStream may not have resume() in all versions, 
            // but we check if it's accessible.
            (stream as any).resume?.();
          }
        });
        
        stream.onData((chunk: string | number[]) => {
          if (socket.destroyed) {
            (stream as any).close?.();
            return reject(new Error('Socket destroyed'));
          }

          let binary: Buffer;
          if (typeof chunk === 'string') {
            binary = Buffer.from(chunk, 'base64');
          } else {
            binary = Buffer.from(chunk as number[]);
          }

          const canWrite = socket.write(binary);
          offset += binary.length;

          if (offset - lastReport >= 512 * 1024) {
            lastReport = offset;
            const pct = Math.min(100, Math.floor((offset / fileSize) * 100));
            const { speed, etaSecs } = tracker.sample(offset, fileSize);
            this.report({ type: 'progress', fileProgress: { name, percent: pct, sent: offset, total: fileSize, speed, etaSecs } });
          }

          if (!canWrite && !isPaused) {
            isPaused = true;
            (stream as any).pause?.();
          }
        });

        stream.onEnd(() => {
          this.report({ type: 'progress', fileProgress: { name, percent: 100, sent: fileSize, total: fileSize, speed: 0, etaSecs: 0 } });
          setTimeout(() => {
            if (!socket.destroyed) socket.end();
            resolve();
          }, 100);
        });

        stream.onError((err) => {
          reject(err);
        });

        stream.open();
      } catch (err) {
        reject(err);
      }
    });
  }

  // ================= START =================
  start(port = 8888, files: any[] = [], onStatus?: any, secretKey?: string, context: ServerContext = 'p2p') {
    this.currentPort = port;
    this.currentContext = context;
    if (!this.server || files.length > 0) {
      this.filesToSend = files;
    }
    this.statusCallback = onStatus;
    this.secretKey = secretKey;

    if (this.server) return { port };

    this.server = TcpSocket.createServer((socket: any) => {
      const remoteIp = socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
      this.handleClientConnected(remoteIp);

      socket.setTimeout(120000); // 120s for slow networks
      socket.on('timeout', () => socket.destroy());

      let rxBufs: Buffer[] = [];
      let rxLen = 0;
      let isBody = false;
      let bodyExpected = 0;
      let bodyReceived = 0;
      let currentRequest: any = null;
      let processingChain = Promise.resolve();

      socket.on('data', (chunk: Buffer) => {
        socket.pause(); // Pause native data emission while we process
        processingChain = processingChain.then(async () => {
          try {
            if (!isBody) {
              rxBufs.push(chunk);
              rxLen += chunk.length;
              const buf = Buffer.concat(rxBufs, rxLen);
              const sep = buf.indexOf('\r\n\r\n');
              if (sep === -1) {
                socket.resume();
                return;
              }

              const headers = buf.slice(0, sep).toString();
              const bodyStart = buf.slice(sep + 4);

              rxBufs = [];
              rxLen = 0;

              const lines = headers.split('\r\n');
              const [method, rawPath] = lines[0].split(' ');
              if (!method || !rawPath) {
                socket.resume();
                return;
              }

              const contentLengthMatch = headers.match(/Content-Length: (\d+)/i);
              const contentLength = contentLengthMatch ? parseInt(contentLengthMatch[1], 10) : 0;
              
              currentRequest = { method, path: rawPath, headers };

              if (method === 'POST') {
                isBody = true;
                bodyExpected = contentLength;
                bodyReceived = bodyStart.length;
                if (rawPath.startsWith('/api/upload')) {
                  await this.handleUploadChunk(socket, currentRequest, bodyStart, false, bodyReceived >= bodyExpected);
                }
              } else {
                this.handleGet(socket, currentRequest, remoteIp);
              }
            } else {
              bodyReceived += chunk.length;
              if (currentRequest?.path.startsWith('/api/upload')) {
                await this.handleUploadChunk(socket, currentRequest, chunk, true, bodyReceived >= bodyExpected);
              }
            }
            
            // Only resume if we haven't already ended/destroyed the socket
            if (socket.readyState === 'open') {
              socket.resume();
            }
          } catch (e: any) {
            console.error('[SERVER DATA PROCESSING ERROR]', e);
            socket.destroy();
          }
        });
      });

      socket.on('close', () => {
        this.handleClientDisconnected(remoteIp);
      });

      socket.on('error', (err: any) => {
        socket.destroy();
      });

    }).listen({ port, host: '0.0.0.0' }, () => {
      DiscoveryManager.publishService(port);
    });

    return { port };
  }

  private handleGet(socket: any, req: any, remoteIp: string) {
    const { path } = req;

    if (path.startsWith('/api/files')) {
      const list = this.filesToSend.map(f => ({
        ...f,
        token: this.getAuthData(f, remoteIp),
      }));
      const body = JSON.stringify(list);
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    } else if (path.startsWith('/api/download')) {
      this.processDownload(socket, path);
    } else if (path === '/' || path === '/index.html' || path === '') {
      const html = this.getPage();
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n${html}`);
    } else {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    }
  }

  private async processDownload(socket: any, path: string) {
    const name = decodeURIComponent(path.match(/name=([^& ]+)/)?.[1] || '');
    const token = path.match(/token=([^& ]+)/)?.[1] || '';
    const file = this.filesToSend.find(f => f.name === name);

    if (!file) return socket.end('HTTP/1.1 404 Not Found\r\n\r\n');

    // Token check
    const remoteIp = socket.remoteAddress?.replace('::ffff:', '') || '';
    const tokenData = this.tokens.get(`${file.name}|${file.size}|${remoteIp}`);
    if (!tokenData || tokenData.token !== token) {
      return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    }

    try {
      const stat = await ReactNativeBlobUtil.fs.stat(file.uri);
      const size = stat.size;
      
      const headers = [
        'HTTP/1.1 200 OK',
        'Content-Type: application/octet-stream',
        `Content-Length: ${size}`,
        `Content-Disposition: attachment; filename="${encodeURIComponent(file.name)}"`,
        'Connection: close',
        '',
        ''
      ].join('\r\n');

      socket.write(headers);
      await this.pipeToSocket(socket, file.uri, size, 0, size - 1, file.name, new SpeedTracker());
    } catch (e) {
      socket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    }
  }

  private async handleUploadChunk(socket: any, req: any, chunk: Buffer, isContinued = false, isDone = true) {
    const path = req.path;
    const name = decodeURIComponent(path.match(/name=([^& ]+)/)?.[1] || 'unnamed');
    const totalSize = parseInt(path.match(/size=(\d+)/)?.[1] || '0', 10);
    const offset = parseInt(path.match(/offset=(\d+)/)?.[1] || '0', 10);
    const isLast = path.includes('last=1');
    const remoteIp = socket.remoteAddress?.replace('::ffff:', '') || '0_0_0_0';
    const saveDir = Platform.OS === 'android'
      ? `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/FlashDrop`
      : `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/FlashDrop`;
    
    const tempPath = `${saveDir}/.tmp_${remoteIp.replace(/\./g, '_')}_${name}`;

    try {
      if (chunk.length > 0) {
        if (!(await ReactNativeBlobUtil.fs.exists(saveDir))) {
          await ReactNativeBlobUtil.fs.mkdir(saveDir);
        }

        const dataBase64 = chunk.toString('base64');
        if (!isContinued && offset === 0) {
          await ReactNativeBlobUtil.fs.writeFile(tempPath, dataBase64, 'base64');
        } else {
          await ReactNativeBlobUtil.fs.appendFile(tempPath, dataBase64, 'base64');
        }
      }

      if (!isDone) return; 

      this.report({
        type: 'upload_progress',
        fileProgress: {
          name,
          percent: Math.min(100, Math.floor(((offset + chunk.length) / totalSize) * 100)),
          sent: offset + chunk.length,
          total: totalSize
        }
      });

      if (isLast) {
        const finalPath = `${saveDir}/${name}`;
        if (await ReactNativeBlobUtil.fs.exists(finalPath)) await ReactNativeBlobUtil.fs.unlink(finalPath);
        await ReactNativeBlobUtil.fs.mv(tempPath, finalPath);
        this.report({ type: 'complete', message: `Received ${name}` });
        saveHistoryItem({ fileName: name, fileSize: totalSize, type: 'file', role: 'received', status: 'success' });
      }

      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');

    } catch (e: any) {
      console.log('[UPLOAD ERROR]', e);
      socket.end('HTTP/1.1 500 Server Error\r\n\r\n');
    }
  }

  public handleClientConnected(clientAddress: string) {
    this.report({ type: 'client_connected', clientAddress });
  }

  public handleClientDisconnected(clientAddress: string) {
    this.report({ type: 'client_disconnected', clientAddress });
  }

  public updateFiles(files: any[]) {
    files.forEach(f => {
      if (!this.filesToSend.find(existing => existing.name === f.name)) {
        this.filesToSend.push(f);
      }
    });
    this.report({ type: 'log', message: `Server updated: Total files ${this.filesToSend.length}` });
  }

  stop() {
    this.server?.close();
    this.server = null;
    this.tokens.clear();
    DiscoveryManager.stopPublishing();
  }

  getPort() {
    return this.currentPort;
  }
  onPeerRegistered(cb?: (ip: string, port: number) => void) { this.peerRegisteredCb = cb; }
  getPeerInfo() { return { ip: this.peerIp, port: this.peerServerPort }; }
}
const TransferServerInstance = new TransferServer();
export const startServer = (port = 8888) => TransferServerInstance.start(port, [], undefined, undefined, 'pc');
export const stopServer = () => TransferServerInstance.stop();
export const generateServerUrl = async (): Promise<string> => {
  try {
    const DeviceInfo = require('react-native-device-info');
    const ip = await DeviceInfo.getIpAddress();
    if (ip && ip !== '0.0.0.0') return `http://${ip}:${TransferServerInstance.getPort()}`;
  } catch (_) { }
  return `http://localhost:${TransferServerInstance.getPort()}`;
};
export default TransferServerInstance;