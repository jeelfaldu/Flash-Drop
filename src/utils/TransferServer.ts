import TcpSocket from 'react-native-tcp-socket';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import { saveHistoryItem } from './HistoryService';
import DiscoveryManager from './DiscoveryManager';

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
  private currentPort: number = 8888;
    
  start(port = 8888, files: any[], onStatus?: (status: ServerStatus) => void) {
    this.currentPort = port;
    this.filesToSend = files;
    this.statusCallback = onStatus;

    if (this.server) {
      console.log(`[TransferServer] Server already running on 0.0.0.0:${port}, updating handlers.`);
      return { port };
    }

    console.log(`[TransferServer] Starting on 0.0.0.0:${port}`);
        
        this.server = TcpSocket.createServer((socket) => {
          const address: any = socket.address();
          const clientIp = typeof address === 'string' ? address : address.address;
          console.log('[TransferServer] Client connected from:', clientIp);

          // Upload state for this connection
          let uploadState = {
            receiving: false,
            fileName: '',
            fileSize: 0,
            receivedBytes: 0,
            filePath: '',
            writePromise: Promise.resolve()
          };

          if (this.statusCallback && !this.connectedClients.has(clientIp)) {
            this.connectedClients.add(clientIp);
            this.statusCallback({
              type: 'client_connected',
              clientAddress: clientIp
            });
          }
            
            socket.on('data', async (data) => {
              // If we are already receiving a file, treat data as file content
              if (uploadState.receiving) {
                uploadState.receivedBytes += data.length;
                const chunkBase64 = data.toString('base64');

                  // Chain writes to ensure order
                  uploadState.writePromise = uploadState.writePromise.then(() =>
                    RNFS.appendFile(uploadState.filePath, chunkBase64, 'base64')
                  );

                  if (uploadState.receivedBytes >= uploadState.fileSize) {
                    uploadState.receiving = false;
                    await uploadState.writePromise;
                    console.log(`[TransferServer] File received: ${uploadState.fileName}`);

                    // Notify status
                    if (this.statusCallback) {
                      this.statusCallback({
                        type: 'complete',
                        message: `Received ${uploadState.fileName}`
                      });
                    }

                  // Add to available files list so it shows up in "Send to Phone" (optional, but good verification)
                  // Actually, this file is ON the phone now.
                  // We might want to show it in the UI list if we want to confirm receipt? 
                  // For now let's just respond success.

                  const res = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
                  socket.write(res, 'utf8', () => {
                    socket.end(); // Must close when Connection: close is specified
                  });

                  // Save history
                  saveHistoryItem({
                    fileName: uploadState.fileName,
                    fileSize: uploadState.fileSize,
                    type: 'unknown',
                    role: 'received',
                    status: 'success'
                  });
                }
                return;
              }

              const msg = data.toString(); // Peek at data as string

              // ── Check Upload Status: GET /api/upload/check ──────────────────────
              // Browser uses this before uploading to know if a partial file exists
              // Response: { received: N }  where N = bytes already on disk (0 = fresh)
              if (msg.startsWith('GET /api/upload/check')) {
                const nameMatch = msg.match(/name=([^&\s]+)/);
                if (nameMatch) {
                  const fileName = decodeURIComponent(nameMatch[1]);
                  const destPath = (Platform.OS === 'android' ? RNFS.DownloadDirectoryPath : RNFS.DocumentDirectoryPath) + '/' + fileName;
                  let receivedBytes = 0;
                  try {
                    if (await RNFS.exists(destPath)) {
                      const stat = await RNFS.stat(destPath);
                      receivedBytes = stat.size;
                    }
                  } catch (_) { }
                  const json = JSON.stringify({ received: receivedBytes });
                  socket.write(
                    `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: ${json.length}\r\nConnection: close\r\n\r\n${json}`,
                    'utf8', () => socket.end()
                  );
                  return;
                }
              }

              // Handle Upload Request: POST /api/upload
              if (msg.startsWith('POST /api/upload')) {
                // Parse Query Params for name and size
                const nameMatch = msg.match(/name=([^&\s]+)/);
                const sizeMatch = msg.match(/size=([^&\s]+)/);

                if (nameMatch && sizeMatch) {
                  const fileName = decodeURIComponent(nameMatch[1]);
                  const fileSize = parseInt(sizeMatch[1]);
                  const destPath = (Platform.OS === 'android' ? RNFS.DownloadDirectoryPath : RNFS.DocumentDirectoryPath) + '/' + fileName;

                  // ── Parse Content-Range for resume support ────────────────
                  // Browser sends: Content-Range: bytes N-END/TOTAL when resuming
                  const rangeMatch = msg.match(/Content-Range:\s*bytes\s*(\d+)-/i);
                  const uploadOffset = rangeMatch ? parseInt(rangeMatch[1], 10) : 0;
                  const isResume = uploadOffset > 0;

                  console.log(`[TransferServer] ${isResume ? '\u23e9 Resuming' : 'Receiving'} upload: ${fileName} (${fileSize} bytes, offset: ${uploadOffset})`);

                  // Initialize upload state
                  // On resume: start receivedBytes from uploaded offset, APPEND to file
                  // On fresh:  clear file first
                  uploadState = {
                    receiving: true,
                    fileName: fileName,
                    fileSize: fileSize,
                    receivedBytes: uploadOffset,
                    filePath: destPath,
                    writePromise: isResume
                      ? Promise.resolve()          // file already has data up to offset
                      : RNFS.writeFile(destPath, '', 'utf8') // fresh: clear/create
                  };

                  // Find body start
                  const bodyStartIndex = msg.indexOf('\r\n\r\n');
                  if (bodyStartIndex !== -1) {
                    const headerSize = bodyStartIndex + 4;
                    const bodyBuffer = data.slice(headerSize);

                    if (bodyBuffer.length > 0) {
                      uploadState.receivedBytes += bodyBuffer.length;
                      const chunkBase64 = bodyBuffer.toString('base64');
                      uploadState.writePromise = uploadState.writePromise.then(() =>
                        RNFS.appendFile(uploadState.filePath, chunkBase64, 'base64')
                      );
                    }

                    // Check if completed in one chunk
                    if (uploadState.receivedBytes >= uploadState.fileSize) {
                      uploadState.receiving = false;
                      await uploadState.writePromise;
                      console.log(`[TransferServer] \u2705 File received (single chunk): ${uploadState.fileName}`);
                      const res = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
                      socket.write(res, 'utf8', () => socket.end());
                      saveHistoryItem({
                        fileName: uploadState.fileName,
                        fileSize: uploadState.fileSize,
                        type: 'unknown',
                        role: 'received',
                        status: 'success'
                      });
                    }
                  }
                  return;
                }
              }

              // Handle HTTP Request (Browser)
              if (msg.startsWith('GET') || msg.includes('HTTP/1.1')) {
                // Check if specific API endpoints are requested first
                if (msg.startsWith('GET /api/files')) {
                  const fileList = this.filesToSend.map(f => ({
                    name: f.name,
                    size: f.size, 
                    type: f.type,
                    uri: f.uri 
                  }));
                  const json = JSON.stringify(fileList);
                  const response = `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${json.length}\r\nConnection: close\r\n\r\n${json}`;
                  socket.write(response, 'utf8', () => socket.end());
                  return;
                }

                if (msg.startsWith('GET /api/download')) {
                  const match = msg.match(/name=([^&\s]+)/);
                  if (match && match[1]) {
                    const fileName = decodeURIComponent(match[1]);
                    const file = this.filesToSend.find(f => f.name === fileName);

                    if (file) {
                      console.log(`[TransferServer] Serving file via HTTP: ${fileName}`);
                      let fileSize = 0;
                      let readPath = file.uri;
                      let isTempFileHttp = false;

                      try {
                        if (typeof file.rawSize === 'number') fileSize = file.rawSize;
                        else if (typeof file.size === 'number') fileSize = file.size;
                        if (fileSize === 0) {
                          const stat = await RNFS.stat(file.uri);
                          fileSize = stat.size;
                        }
                      } catch (e) { console.error('Stat error', e); }

                      // ── Android content:// URI → copy to temp dir ──
                      if (Platform.OS === 'android' && file.uri.startsWith('content://')) {
                        const tempPath = `${RNFS.CachesDirectoryPath}/http_${file.name}_${Date.now()}`;
                        try {
                          await RNFS.copyFile(file.uri, tempPath);
                          readPath = tempPath;
                          isTempFileHttp = true;
                        } catch (e) {
                          console.error('[TransferServer] HTTP temp copy failed', e);
                        }
                      }

                      // ── Parse Range header (for resume support) ──
                      const rangeMatch = msg.match(/Range:\s*bytes=(\d+)-/i);
                      const startByte = rangeMatch ? parseInt(rangeMatch[1], 10) : 0;
                      const isRangeRequest = startByte > 0;
                      const contentLength = fileSize - startByte;

                      // ── Choose dynamic chunk size ──
                      // Large files → bigger chunks = fewer read() calls = faster
                      const chunkSize = fileSize > 100 * 1024 * 1024
                        ? 512 * 1024   // 512 KB for >100MB
                        : fileSize > 10 * 1024 * 1024
                          ? 256 * 1024 // 256 KB for 10-100MB
                          : 64 * 1024; // 64 KB for <10MB

                      const statusLine = isRangeRequest
                        ? `HTTP/1.1 206 Partial Content\r\n`
                        : `HTTP/1.1 200 OK\r\n`;

                      let responseHeaders = statusLine +
                        `Content-Type: application/octet-stream\r\n` +
                        `Content-Disposition: attachment; filename="${fileName}"\r\n` +
                        `Content-Length: ${contentLength}\r\n` +
                        `Accept-Ranges: bytes\r\n`;

                      if (isRangeRequest) {
                        responseHeaders += `Content-Range: bytes ${startByte}-${fileSize - 1}/${fileSize}\r\n`;
                      }
                      responseHeaders += `Connection: close\r\n\r\n`;

                      socket.write(responseHeaders, 'utf8');
                      console.log(`[TransferServer] HTTP Serving: ${fileName} from byte ${startByte} (${isRangeRequest ? 'RESUME' : 'FULL'})`);

                      try {
                        let offset = startByte;
                        let lastReportedPercent = -1;
                        while (offset < fileSize && !socket.destroyed) {
                          const currentChunkSize = Math.min(chunkSize, fileSize - offset);
                          const chunkBase64 = await RNFS.read(readPath, currentChunkSize, offset, 'base64');
                          const buffer = Buffer.from(chunkBase64, 'base64');

                          // ── Backpressure: wait for drain if buffer is full ──
                          const canWrite = socket.write(buffer);
                          if (!canWrite) {
                            await new Promise<void>(resolve => {
                              const tId = setTimeout(() => {
                                socket.removeListener('drain', onDrain);
                                resolve();
                              }, 150);
                              const onDrain = () => {
                                clearTimeout(tId);
                                resolve();
                              };
                              socket.once('drain', onDrain);
                            });
                          }

                          offset += buffer.length;

                          // ── Progress reporting (keeps sender UI synced) ──
                          const currentPercent = Math.floor((offset / fileSize) * 100);
                          if (this.statusCallback && (currentPercent >= lastReportedPercent + 2 || offset >= fileSize)) {
                            lastReportedPercent = currentPercent;
                            this.statusCallback({
                              type: 'progress',
                              fileProgress: { name: fileName, percent: currentPercent, sent: offset, total: fileSize }
                            });
                          }
                        }
                        console.log(`[TransferServer] HTTP File sent: ${fileName}`);
                      } catch (e) {
                        console.error('HTTP Send error', e);
                      } finally {
                        if (isTempFileHttp && await RNFS.exists(readPath)) {
                          RNFS.unlink(readPath).catch(() => { });
                        }
                        socket.end();
                      }
                      return;
                    }
                  }
                  const notFound = "File not found";
                  socket.write(`HTTP/1.1 404 Not Found\r\nContent-Length: ${notFound.length}\r\nAccept-Ranges: bytes\r\n\r\n${notFound}`);
                  socket.end();
                  return;
                }

                // Default: Serve HTML
                const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FlashDrop - PC Connect</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root { --primary: #2563EB; --primary-dark: #1E40AF; --secondary: #10B981; --bg: #F8FAFC; --surface: #FFFFFF; --text: #1E293B; --text-light: #64748B; --border: #E2E8F0; }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Outfit', sans-serif; }
        body { background-color: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; }
        header { background: var(--surface); padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); position: sticky; top: 0; z-index: 10; }
        .logo { font-size: 1.5rem; font-weight: 800; color: var(--primary); display: flex; align-items: center; gap: 0.5rem; }
        .badge { background: #DCFCE7; color: #166534; padding: 0.25rem 0.75rem; border-radius: 99px; font-size: 0.875rem; font-weight: 600; display: flex; align-items: center; gap: 0.25rem; }
        .badge::before { content: ''; width: 6px; height: 6px; background: #166534; border-radius: 50%; display: block; animation: pulse 2s infinite; }
        main { flex: 1; padding: 2rem; max-width: 1200px; margin: 0 auto; width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start; }
        .card { background: var(--surface); border-radius: 1.5rem; padding: 2rem; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); transition: transform 0.2s; height: 100%; }
        .card:hover { transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05); }
        .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; }
        .icon-box { width: 3rem; height: 3rem; border-radius: 1rem; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; }
        .icon-send { background: #EFF6FF; color: var(--primary); }
        .icon-receive { background: #ECFDF5; color: var(--secondary); }
        h2 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
        p { color: var(--text-light); line-height: 1.5; }
        .dropzone { border: 2px dashed var(--border); border-radius: 1rem; padding: 3rem 1rem; text-align: center; background: #FAFAFA; transition: all 0.2s; cursor: pointer; margin-top: 1.5rem; }
        .dropzone:hover { border-color: var(--primary); background: #EFF6FF; }
        .drop-icon { font-size: 2.5rem; color: var(--text-light); margin-bottom: 1rem; }
        .btn { background: var(--primary); color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.75rem; font-weight: 600; cursor: pointer; margin-top: 1rem; transition: background 0.2s; }
        .btn:hover { background: var(--primary-dark); }
        .btn-secondary { background: white; border: 1px solid var(--border); color: var(--text); }
        .btn-secondary:hover { background: #F8FAFC; border-color: #CBD5E1; }
        .file-list { margin-top: 1.5rem; display: flex; flex-direction: column; gap: 0.75rem; }
        .file-item { display: flex; align-items: center; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.75rem; }
        .file-icon { width: 2.5rem; height: 2.5rem; background: #F1F5F9; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; margin-right: 1rem; color: var(--text-light); }
        .file-info { flex: 1; }
        .file-name { font-weight: 600; font-size: 0.9rem; margin-bottom: 0.1rem; }
        .file-size { font-size: 0.75rem; color: var(--text-light); }
        .empty-state { text-align: center; padding: 2rem; color: var(--text-light); }
        @media (max-width: 768px) { main { grid-template-columns: 1fr; padding: 1rem; } .card { margin-bottom: 1rem; } }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
    </style>
</head>
<body>
    <header>
        <div class="logo"><i class="fa-solid fa-bolt"></i> FlashDrop</div>
        <div class="badge">Connected</div>
    </header>
    <main>
        <section class="card">
            <div class="card-header">
                <div><h2>Send to Phone</h2><p>Drag files here to send them to your mobile device instantly.</p></div>
                <div class="icon-box icon-send"><i class="fa-solid fa-paper-plane"></i></div>
            </div>
            <div class="dropzone" id="dropzone">
                <div class="drop-icon"><i class="fa-solid fa-cloud-arrow-up"></i></div>
                <h3>Drop files here</h3>
                <p style="font-size: 0.875rem; margin-top: 0.5rem;">or click to browse</p>
                <button class="btn" onclick="document.getElementById('fileInput').click()">Select Files</button>
                <input type="file" id="fileInput" hidden multiple onchange="handleFileSelect(event)">
            </div>
        </section>
        <section class="card">
            <div class="card-header">
                <div><h2>Receive from Phone</h2><p>Files sent from your mobile device will appear here.</p></div>
                <div class="icon-box icon-receive"><i class="fa-solid fa-download"></i></div>
            </div>
            <div class="file-list" id="fileList">
                <div class="empty-state">
                    <i class="fa-regular fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.3;"></i>
                    <p>No files shared yet</p>
                    <p style="font-size: 0.75rem;">Send files from your phone to see them here</p>
                </div>
            </div>
        </section>
    </main>
    <script>
        const dropzone = document.getElementById('dropzone');
        const fileListEl = document.getElementById('fileList');

        async function loadFiles() {
            try {
                const response = await fetch('/api/files');
                const files = await response.json();
                renderFiles(files);
            } catch (e) { console.error('Error loading files:', e); }
        }

        function renderFiles(files) {
            fileListEl.innerHTML = '';
            if (files.length === 0) {
                fileListEl.innerHTML = \`
                    <div class="empty-state">
                        <i class="fa-regular fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.3;"></i>
                        <p>No files shared yet</p>
                        <p style="font-size: 0.75rem;">Send files from your phone to see them here</p>
                    </div>\`;
                return;
            }

            files.forEach(file => {
                const sizeStr = formatSize(file.size);
                const item = document.createElement('div');
                item.className = 'file-item';
                item.innerHTML = \`
                    <div class="file-icon"><i class="fa-solid fa-file"></i></div>
                    <div class="file-info">
                        <div class="file-name">\${file.name}</div>
                        <div class="file-size">\${sizeStr}</div>
                    </div>
                    <a href="/api/download?name=\${encodeURIComponent(file.name)}" class="btn btn-secondary" style="padding: 0.5rem; text-decoration: none; display: inline-block;">
                        <i class="fa-solid fa-download"></i>
                    </a>\`;
                fileListEl.appendChild(item);
            });
        }

        function formatSize(bytes) {
            if(typeof bytes !== 'number') return bytes || 'Unknown';
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }

        async function handleFileSelect(event) {
            const files = event.target.files;
            if (!files.length) return;
            let allOk = true;
            for (let i = 0; i < files.length; i++) {
                const ok = await uploadFile(files[i]);
                if (!ok) allOk = false;
            }
            if (allOk) alert('Files uploaded successfully!');
        }

        async function uploadFile(file) {
            try {
                // ── Check if server already has a partial copy ──
                const checkRes = await fetch(\`/api/upload/check?name=\${encodeURIComponent(file.name)}\`);
                const { received } = checkRes.ok ? await checkRes.json() : { received: 0 };

                const isResume = received > 0 && received < file.size;
                const startByte = isResume ? received : 0;
                const blob = file.slice(startByte); // send only remaining bytes

                const url = \`/api/upload?name=\${encodeURIComponent(file.name)}&size=\${file.size}\`;
                const headers = {};
                if (isResume) {
                    headers['Content-Range'] = \`bytes \${startByte}-\${file.size - 1}/\${file.size}\`;
                    console.log(\`Resuming \${file.name} from byte \${startByte}\`);
                }

                await fetch(url, { method: 'POST', body: blob, headers });
                return true;
            } catch (e) {
                console.error('Upload failed', e);
                alert('Failed to upload ' + file.name);
                return false;
            }
        }

        loadFiles();
        setInterval(loadFiles, 5000);

        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--primary)'; dropzone.style.background = '#EFF6FF'; });
        dropzone.addEventListener('dragleave', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--border)'; dropzone.style.background = '#FAFAFA'; });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--border)';
            dropzone.style.background = '#FAFAFA';

            const files = e.dataTransfer.files;
            if (files.length) {
                handleFileSelect({ target: { files: files } });
            }
        });
    </script>
</body>
</html>
`;
                const response = `HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${html.length}\r\nConnection: close\r\n\r\n${html}`;

                console.log('[TransferServer] Sending HTTP response...');
                socket.write(response, 'utf8', (err: any) => {
                  if (err) console.error('[TransferServer] Write error:', err);
                  console.log('[TransferServer] Closing connection.');
                  socket.end();
                });
                return;
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
          // ── Publish mDNS so receivers can find us without hardcoded IPs ──
          DiscoveryManager.publishService(port);
        });
        
        return { port };
    }

  updateFiles(newFiles: any[]) {
    newFiles.forEach(nf => {
      const exists = this.filesToSend.find(f => f.name === nf.name && f.uri === nf.uri);
      if (!exists) {
        this.filesToSend.push(nf);
      }
    });
    console.log(`[TransferServer] Files updated. Total: ${this.filesToSend.length}`);
    }

  async sendFile(socket: any, fileName: string, startOffset = 0) {
    if (!socket || socket.destroyed) return;

    const normalizedRequestedName = fileName.trim().toLowerCase();
    const file = this.filesToSend.find(f =>
      f.name.trim().toLowerCase() === normalizedRequestedName
    );

    if (!file) {
      console.log(`[TransferServer] File not found. Requested: "${fileName}". Available:`,
        this.filesToSend.map(f => f.name).join(', '));
      return;
    }

    try {
      console.log(`[TransferServer] Sending file: ${file.name} from offset: ${startOffset}`);

      let fileSize = 0;
      if (typeof file.rawSize === 'number') fileSize = file.rawSize;
      else if (typeof file.size === 'number') fileSize = file.size;
      if (fileSize === 0) {
        try { const stat = await RNFS.stat(file.uri); fileSize = stat.size; } catch (_) { }
      }

      // ── Dynamic chunk size based on file size ──────────────────────────────
      // Larger chunks = fewer async read() calls = higher throughput for big files
      const chunkSize = fileSize > 100 * 1024 * 1024
        ? 512 * 1024   // 512 KB for >100 MB files
        : fileSize > 10 * 1024 * 1024
          ? 256 * 1024 // 256 KB for 10–100 MB files
          : 64 * 1024; // 64 KB  for <10 MB files

      let offset = startOffset;
      let readPath = file.uri;
      let isTempFile = false;
      let lastReportedPercent = -1;

      // ── Android content:// URI → copy to temp cache ────────────────────────
      if (Platform.OS === 'android' && file.uri.startsWith('content://')) {
        const tempPath = `${RNFS.CachesDirectoryPath}/send_${file.name}_${Date.now()}`;
        try {
          await RNFS.copyFile(file.uri, tempPath);
          readPath = tempPath;
          isTempFile = true;
        } catch (e) {
          console.error('[TransferServer] Temp copy failed', e);
          throw e;
        }
      }

      try {
        while (offset < fileSize && !socket.destroyed) {
          const remaining = fileSize - offset;
          const currentChunkSize = Math.min(chunkSize, remaining);
          const chunkBase64 = await RNFS.read(readPath, currentChunkSize, offset, 'base64');
          const buffer = Buffer.from(chunkBase64, 'base64');

          if (socket.destroyed) break;

          // ── Backpressure: pause reads when socket buffer is full ──────────
          const canWrite = socket.write(buffer);
          if (!canWrite) {
            await new Promise<void>(resolve => {
              const tId = setTimeout(() => {
                socket.removeListener('drain', onDrain);
                resolve();
              }, 150);
              const onDrain = () => {
                clearTimeout(tId);
                resolve();
              };
              socket.once('drain', onDrain);
            });
          }

          offset += buffer.length;

          // ── Progress reporting every 2% to reduce Zustand churn ──────────
          const currentPercent = Math.floor((offset / fileSize) * 100);
          if (this.statusCallback && (currentPercent >= lastReportedPercent + 2 || offset >= fileSize)) {
            lastReportedPercent = currentPercent;
            this.statusCallback({
              type: 'progress',
              fileProgress: { name: file.name, percent: currentPercent, sent: offset, total: fileSize }
            });
          }
        }

        if (offset >= fileSize) {
          console.log(`[TransferServer] ✅ Sent ${fileName} (${fileSize} bytes)`);
          saveHistoryItem({
            fileName: file.name,
            fileSize,
            type: file.type || 'unknown',
            role: 'sent',
            status: 'success'
          });
        }
      } finally {
        if (isTempFile && await RNFS.exists(readPath)) {
          await RNFS.unlink(readPath).catch(() => { });
        }
      }
    } catch (e: any) {
      console.error('[TransferServer] Send failed:', e);
      if (this.statusCallback) this.statusCallback({ type: 'error', message: e.message });
    }
  }

    stop() {
        if (this.server) {
            this.server.close(); 
            this.server = null;
        }
      this.connectedClients.clear();
    // ── Unpublish mDNS so stale services don't linger ──
    DiscoveryManager.stopPublishing();
  }

  getPort() {
    return this.currentPort;
    }
}

const TransferServerInstance = new TransferServer();

export const startServer = async (port = 8888) => {
  return TransferServerInstance.start(port, []);
};

export const stopServer = () => {
  TransferServerInstance.stop();
};

export const generateServerUrl = async () => {
  try {
    const DeviceInfo = require('react-native-device-info');
    const ip = await DeviceInfo.getIpAddress();
    const port = TransferServerInstance.getPort();
    if (ip && ip !== '0.0.0.0') {
      return `http://${ip}:${port}`;
    }
  } catch (e) {
    console.log('Error getting IP via DeviceInfo', e);
  }
  return `http://localhost:${TransferServerInstance.getPort()}`;
};

export default TransferServerInstance;
