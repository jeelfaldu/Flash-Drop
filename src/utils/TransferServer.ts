import TcpSocket from 'react-native-tcp-socket';
import RNBlobUtil from 'react-native-blob-util';
import { Platform } from 'react-native';
import DiscoveryManager from './DiscoveryManager';
import { Buffer } from 'buffer';

export interface ServerStatus {
  type: 'listening' | 'client_connected' | 'client_disconnected' | 'progress' | 'upload_progress' | 'complete' | 'error';
  port?: number;
  clientAddress?: string;
  progress?: number;
  fileName?: string;
  message?: string;
  fileProgress?: { name: string; percent: number; sent: number; total: number; speed?: number };
}

// ─── Full HTML web UI served at GET / ────────────────────────────────────────
const WEB_UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlashDrop - PC Connect</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Outfit',sans-serif}
:root{--p:#2563EB;--pd:#1E40AF;--g:#10B981;--bg:#F8FAFC;--w:#fff;--t:#1E293B;--m:#64748B;--b:#E2E8F0}
body{background:var(--bg);color:var(--t);min-height:100vh;display:flex;flex-direction:column}
header{background:var(--w);padding:1rem 2rem;display:flex;justify-content:space-between;align-items:center;box-shadow:0 1px 3px rgba(0,0,0,.06);position:sticky;top:0;z-index:10}
.logo{font-size:1.4rem;font-weight:800;color:var(--p);display:flex;align-items:center;gap:.5rem}
.badge{background:#DCFCE7;color:#166534;padding:.25rem .75rem;border-radius:99px;font-size:.8rem;font-weight:600;display:flex;align-items:center;gap:.4rem}
.dot{width:7px;height:7px;background:#16a34a;border-radius:50%;animation:blink 1.5s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
main{flex:1;padding:2rem;max-width:1100px;margin:0 auto;width:100%;display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
.card{background:var(--w);border-radius:1.25rem;padding:1.75rem;border:1px solid var(--b);box-shadow:0 2px 8px rgba(0,0,0,.04)}
.card-title{font-size:1.1rem;font-weight:700;margin-bottom:.25rem}
.card-sub{font-size:.85rem;color:var(--m);margin-bottom:1.25rem}
.dropzone{border:2px dashed var(--b);border-radius:1rem;padding:2.5rem 1rem;text-align:center;background:#FAFAFA;cursor:pointer;transition:all .2s}
.dropzone.over{border-color:var(--p);background:#EFF6FF}
.dz-icon{font-size:2.2rem;margin-bottom:.75rem}
.dz-title{font-weight:600;font-size:.95rem;margin-bottom:.25rem}
.dz-sub{font-size:.8rem;color:var(--m)}
.btn{background:var(--p);color:#fff;border:none;padding:.6rem 1.25rem;border-radius:.6rem;font-weight:600;font-size:.85rem;cursor:pointer;transition:background .2s;display:inline-flex;align-items:center;gap:.4rem;margin-top:.75rem}
.btn:hover{background:var(--pd)}
.btn-outline{background:#fff;color:var(--t);border:1px solid var(--b)}
.btn-outline:hover{background:#F1F5F9}
.prog-list{margin-top:1rem;display:flex;flex-direction:column;gap:.6rem}
.prog-item{background:#F8FAFC;border:1px solid var(--b);border-radius:.75rem;padding:.75rem}
.prog-name{font-size:.82rem;font-weight:600;margin-bottom:.4rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prog-track{background:#E2E8F0;border-radius:99px;height:6px;overflow:hidden}
.prog-fill{height:100%;background:var(--p);border-radius:99px;width:0%;transition:width .3s}
.prog-fill.done{background:var(--g)}
.prog-meta{display:flex;justify-content:space-between;font-size:.75rem;color:var(--m);margin-top:.3rem}
.file-list{display:flex;flex-direction:column;gap:.6rem}
.file-item{display:flex;align-items:center;gap:.75rem;padding:.75rem;border:1px solid var(--b);border-radius:.75rem}
.file-icon{width:2.2rem;height:2.2rem;background:#EFF6FF;color:var(--p);border-radius:.5rem;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0}
.file-info{flex:1;min-width:0}
.file-name{font-weight:600;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.file-size{font-size:.75rem;color:var(--m)}
.empty{text-align:center;padding:2.5rem 1rem;color:var(--m)}
.empty-icon{font-size:2rem;opacity:.3;display:block;margin-bottom:.5rem}
@media(max-width:700px){main{grid-template-columns:1fr;padding:1rem}}
</style>
</head>
<body>
<header>
  <div class="logo">&#9889; FlashDrop</div>
  <div class="badge"><span class="dot"></span> Connected</div>
</header>
<main>
  <section class="card">
    <div class="card-title">&#128228; Send to Phone</div>
    <div class="card-sub">Select or drag files to transfer to your mobile device</div>
    <div class="dropzone" id="dropzone">
      <div class="dz-icon">&#9729;</div>
      <div class="dz-title">Drop files here</div>
      <div class="dz-sub" style="margin-bottom:.75rem">or click the button below</div>
      <button class="btn" id="selectBtn">&#128193; Select Files</button>
      <input type="file" id="fileInput" multiple hidden>
    </div>
    <div class="prog-list" id="progList"></div>
  </section>
  <section class="card">
    <div class="card-title">&#128229; Receive from Phone</div>
    <div class="card-sub">Files shared from your phone appear here for download</div>
    <div class="file-list" id="fileList">
      <div class="empty"><span class="empty-icon">&#128194;</span>No files shared yet</div>
    </div>
  </section>
</main>
<script>
(function(){
  var dz=document.getElementById('dropzone'),fi=document.getElementById('fileInput'),sb=document.getElementById('selectBtn'),pl=document.getElementById('progList'),fl=document.getElementById('fileList');
  sb.addEventListener('click',function(e){e.stopPropagation();fi.click()});
  fi.addEventListener('change',function(){startUploads(fi.files);fi.value='';});
  dz.addEventListener('click',function(){fi.click()});
  dz.addEventListener('dragover',function(e){e.preventDefault();dz.classList.add('over')});
  dz.addEventListener('dragleave',function(){dz.classList.remove('over')});
  dz.addEventListener('drop',function(e){e.preventDefault();dz.classList.remove('over');startUploads(e.dataTransfer.files)});
  var queue=[],busy=false;
  function startUploads(files){for(var i=0;i<files.length;i++){queue.push(files[i]);mkRow(files[i].name,files[i].size);}if(!busy)pump();}
  async function pump(){if(!queue.length){busy=false;return;}busy=true;await upload(queue.shift());pump();}
  async function upload(file){
    var total=file.size,offset=0,CHUNK=4*1024*1024;
    setPct(file.name,0,0,total);
    while(offset<total){
      var end=Math.min(offset+CHUNK,total),last=(end>=total)?1:0,blob=file.slice(offset,end);
      var url='/api/upload?name='+encodeURIComponent(file.name)+'&size='+total+'&offset='+offset+'&last='+last;
      var ok=await sendChunk(url,blob,file.name,offset,total);
      if(!ok){setErr(file.name);return;}
      offset=end;setPct(file.name,last?100:Math.floor(offset/total*100),offset,total);
    }
  }
  function sendChunk(url,blob,name,cur,tot){
    return new Promise(function(res){
      var x=new XMLHttpRequest();x.timeout=0;
      x.upload.addEventListener('progress',function(e){if(e.lengthComputable){var s=cur+e.loaded;setPct(name,Math.floor(s/tot*100),s,tot);}});
      x.onload=function(){res(x.status===200)};x.onerror=function(){res(false)};x.ontimeout=function(){res(false)};
      x.open('POST',url);x.send(blob);
    });
  }
  function mkRow(name,tot){var id=rid(name);if(document.getElementById(id))return;var r=document.createElement('div');r.id=id;r.className='prog-item';r.innerHTML='<div class="prog-name" title="'+esc(name)+'">'+esc(name)+'</div><div class="prog-track"><div class="prog-fill" id="'+id+'_f"></div></div><div class="prog-meta"><span id="'+id+'_p">0%</span><span id="'+id+'_s">0 / '+fmt(tot)+'</span></div>';pl.appendChild(r);}
  function setPct(name,pct,sent,tot){var id=rid(name),f=document.getElementById(id+'_f'),p=document.getElementById(id+'_p'),s=document.getElementById(id+'_s');if(f){f.style.width=pct+'%';if(pct>=100)f.classList.add('done');}if(p)p.textContent=pct>=100?'Done!':pct+'%';if(s)s.textContent=fmt(sent)+' / '+fmt(tot);}
  function setErr(name){var id=rid(name),f=document.getElementById(id+'_f'),p=document.getElementById(id+'_p');if(f)f.style.background='#EF4444';if(p)p.textContent='Failed';}
  function rid(n){return'row_'+n.replace(/[^a-zA-Z0-9]/g,'_');}
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  async function loadFiles(){try{var r=await fetch('/api/files'),files=await r.json();fl.innerHTML='';if(!files.length){fl.innerHTML='<div class="empty"><span class="empty-icon">&#128194;</span>No files shared yet</div>';return;}files.forEach(function(f){var d=document.createElement('div');d.className='file-item';d.innerHTML='<div class="file-icon">&#128196;</div><div class="file-info"><div class="file-name" title="'+esc(f.name)+'">'+esc(f.name)+'</div><div class="file-size">'+fmt(f.size)+'</div></div><a href="/api/download?name='+encodeURIComponent(f.name)+'" class="btn btn-outline" style="text-decoration:none;padding:.5rem .75rem">&#8659;</a>';fl.appendChild(d);});}catch(e){}}
  function fmt(b){if(!b||typeof b!=='number')return'0 B';var k=1024,u=['B','KB','MB','GB'],i=Math.floor(Math.log(b)/Math.log(k));return(b/Math.pow(k,i)).toFixed(i?1:0)+' '+u[i];}
  loadFiles();setInterval(loadFiles,5000);
})();
</script>
</body>
</html>`;

class TransferServer {
  private server: any = null;
  public statusCallback: ((status: any) => void) | null = null;
  private filesToSend: any[] = [];
  private activeSockets: Map<string, any> = new Map();

  // ── Per-upload state ────────────────────────────────────────────────────────
  private upload: {
    active: boolean;
    finalized: boolean;
    fileName: string;
    fileSize: number;
    received: number;
    tempPath: string;
    finalPath: string;
    stream: any;
    writeQueue: Promise<void>;
  } = { active: false, finalized: false, fileName: '', fileSize: 0, received: 0, tempPath: '', finalPath: '', stream: null, writeQueue: Promise.resolve() };

  constructor() {}

  public start(port: number, files: any[], onStatus?: (status: any) => void) {
    if (onStatus) this.statusCallback = onStatus;
    if (files.length > 0) this.filesToSend = files;

    if (this.server) {
      // Already running, just report current status
      setTimeout(() => this.report({ type: 'listening', port }), 10);
      return { port };
    }

    try {
      this.server = TcpSocket.createServer((socket: any) => {
        const remoteIp = (socket.remoteAddress || 'unknown').replace('::ffff:', '');
        this.activeSockets.set(remoteIp, socket);
        this.report({ type: 'client_connected', clientAddress: remoteIp });

        let rxBufs: Buffer[] = [];
        let rxLen = 0;
        let isBody = false;
        let bodyExpected = 0;
        let currentRequest: any = null;
        let bodyReceived = 0;

        socket.on('data', async (chunk: Buffer) => {
          if (!isBody) {
            rxBufs.push(chunk); rxLen += chunk.length;
            const buf = Buffer.concat(rxBufs);
            const sep = buf.indexOf('\r\n\r\n');
            if (sep === -1) return;

            const headers = buf.slice(0, sep).toString();
            const bodyStart = buf.slice(sep + 4);
            rxBufs = []; rxLen = 0;

            const lines = headers.split('\r\n');
            const [method, rawPath] = lines[0].split(' ');
            if (!method || !rawPath) return;

            console.log(`[TRANSFER SERVER] ${method} ${rawPath} from ${remoteIp}`);
            const contentLenMatch = headers.match(/Content-Length:\s*(\d+)/i);
            bodyExpected = contentLenMatch ? parseInt(contentLenMatch[1], 10) : 0;
            currentRequest = { method, path: rawPath, headers };

            if (method === 'GET' || method === 'HEAD') {
              this.handleGet(socket, rawPath, remoteIp);
              return;
            }

            if (method === 'POST') {
              isBody = true;
              bodyReceived = bodyStart.length;
              rxBufs = []; // No longer need rxBufs for large bodies as we stream them
              
              const isDone = bodyExpected > 0 && bodyReceived >= bodyExpected;
              if (rawPath.startsWith('/api/v2/handshake')) {
                 if (isDone) { await this.handleHandshake(socket, bodyStart, remoteIp); isBody = false; }
                 else { rxBufs = [bodyStart]; } // Handshake needs full buffer
              } else if (rawPath.startsWith('/api/upload')) {
                await this.handleUploadChunk(socket, currentRequest, bodyStart, false, isDone);
                if (isDone) isBody = false;
              } else {
                 rxBufs = [bodyStart]; // Other POSTs
                 if (isDone) isBody = false;
              }
            }
          } else {
            bodyReceived += chunk.length;
            if (currentRequest?.path.startsWith('/api/v2/handshake')) {
              rxBufs.push(chunk);
              if (bodyReceived >= bodyExpected) {
                const fullBody = Buffer.concat(rxBufs);
                await this.handleHandshake(socket, fullBody, remoteIp);
                isBody = false; rxBufs = [];
              }
            } else if (currentRequest?.path.startsWith('/api/upload')) {
              const isDone = bodyReceived >= bodyExpected;
              await this.handleUploadChunk(socket, currentRequest, chunk, true, isDone);
              if (isDone) { isBody = false; rxBufs = []; }
            } else {
              rxBufs.push(chunk);
              if (bodyReceived >= bodyExpected) { isBody = false; rxBufs = []; }
            }
          }
        });

        socket.on('error', (err: any) => {
          console.error(`[TRANSFER SERVER] Socket error from ${remoteIp}:`, err.message);
          this.activeSockets.delete(remoteIp);
        });

        socket.on('close', () => {
          this.report({ type: 'client_disconnected', clientAddress: remoteIp });
          this.activeSockets.delete(remoteIp);
        });
      });

      this.server.listen({ port, host: '0.0.0.0' }, () => {
        console.log(`[TRANSFER SERVER] Listening on port ${port}`);
        this.report({ type: 'listening', port });
        DiscoveryManager.publishService(port);
      });

      this.server.on('error', (err: any) => {
        this.report({ type: 'error', message: err.message });
      });

    } catch (e: any) {
      this.report({ type: 'error', message: e.message });
    }

    return { port };
  }

  // ── GET handler ─────────────────────────────────────────────────────────────
  private handleGet(socket: any, rawPath: string, remoteIp: string) {
    const qi = rawPath.indexOf('?');
    const path = qi >= 0 ? rawPath.slice(0, qi) : rawPath;

    // Root — serve the web UI
    if (path === '/' || path === '/index.html') {
      const html = WEB_UI;
      const bytes = Buffer.byteLength(html, 'utf8');
      const response = `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes}\r\nConnection: close\r\n\r\n${html}`;
      if (!socket.destroyed) try { socket.write(response, 'utf8', () => { if (!socket.destroyed) socket.end(); }); } catch (_) { socket.destroy(); }
      return;
    }

    // File list API (browser polls this)
    if (path === '/api/files') {
      const list = JSON.stringify(this.filesToSend.map(f => ({ name: f.name, size: f.size })));
      const bytes = Buffer.byteLength(list);
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: ${bytes}\r\nConnection: close\r\n\r\n${list}`
      );
      return;
    }

    // Download file
    if (path === '/api/download') {
      this.processDownload(socket, rawPath);
      return;
    }

    // V2 handshake (GET form — just ACK)
    if (path.startsWith('/api/v2/handshake')) {
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }

    // 404
    socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot Found');
  }

  // ── Download file to PC ─────────────────────────────────────────────────────
  private async processDownload(socket: any, rawPath: string) {
    const qi = rawPath.indexOf('?');
    const qs = qi >= 0 ? rawPath.slice(qi + 1) : '';
    const params: Record<string, string> = {};
    qs.split('&').forEach(p => { const eq = p.indexOf('='); if (eq > 0) params[decodeURIComponent(p.slice(0, eq))] = decodeURIComponent(p.slice(eq + 1)); });

    const fileName = params['name'] || '';
    const file = this.filesToSend.find(f => f.name === fileName);
    if (!file) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }

    try {
      let readPath: string = file.uri;
      let isTmp = false;

      const stats = await RNBlobUtil.fs.stat(readPath);
      const size = stats.size;
      if (!socket.destroyed) {
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="${encodeURIComponent(fileName)}"\r\nContent-Length: ${size}\r\nConnection: close\r\n\r\n`
        );
      }
      const stream = await RNBlobUtil.fs.readStream(readPath, 'base64', 4096 * 1024);
      stream.open();
      stream.onData((chunk: any) => {
        if (!socket.destroyed) socket.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk), 'base64');
      });
      stream.onEnd(() => {
        if (!socket.destroyed) socket.end();
        if (isTmp) RNBlobUtil.fs.unlink(readPath).catch(() => {});
      });
      stream.onError(() => {
        if (!socket.destroyed) socket.destroy();
        if (isTmp) RNBlobUtil.fs.unlink(readPath).catch(() => {});
      });
    } catch (e) {
      if (!socket.destroyed) socket.end('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
    }
  }

  // ── Handle V2 handshake POST body ───────────────────────────────────────────
  private async handleHandshake(socket: any, body: Buffer, remoteIp: string) {
    const text = body.toString('utf-8');
    console.log('[V2 Handshake] Body:', text.slice(0, 200));
    try {
      JSON.parse(text);
      this.report({ type: 'client_connected', clientAddress: remoteIp, message: text });
    } catch (_) {}
    if (!socket.destroyed) socket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  }

  // ── Handle upload from PC browser ───────────────────────────────────────────
  private async handleUploadChunk(socket: any, req: any, chunk: Buffer, isCont: boolean, isDone: boolean) {
    const qi = req.path.indexOf('?');
    const qs = qi >= 0 ? req.path.slice(qi + 1) : '';
    const params: Record<string, string> = {};
    qs.split('&').forEach((p: string) => { const eq = p.indexOf('='); if (eq > 0) params[decodeURIComponent(p.slice(0, eq))] = decodeURIComponent(p.slice(eq + 1)); });

    const fileName = params['name'] || 'unknown_file';
    const fileSize = parseInt(params['size'] || '0', 10);
    const offset = parseInt(params['offset'] || '0', 10);
    const isLast = params['last'] === '1';

    const tempPath = `${RNBlobUtil.fs.dirs.CacheDir}/up_${encodeURIComponent(fileName)}`;
    const finalPath = `${Platform.OS === 'android' ? RNBlobUtil.fs.dirs.DownloadDir : RNBlobUtil.fs.dirs.DocumentDir}/${fileName}`;

    // First chunk — init write stream
    if (offset === 0 && !isCont) {
      try { await RNBlobUtil.fs.unlink(tempPath); } catch (_) {}
      const stream = await RNBlobUtil.fs.writeStream(tempPath, 'base64', false).catch(() => null);
      this.upload = { active: true, finalized: false, fileName, fileSize, received: 0, tempPath, finalPath, stream, writeQueue: Promise.resolve() };
    }

    if (chunk.length > 0 && this.upload.stream) {
      this.upload.received += chunk.length;
      const snapReceived = this.upload.received;
      const snapData = chunk.toString('base64');
      const percent = fileSize > 0 ? Math.min(Math.round((snapReceived / fileSize) * 100), 100) : 0;
      this.report({ type: 'upload_progress', fileProgress: { name: fileName, percent, sent: snapReceived, total: fileSize } });
      this.upload.writeQueue = this.upload.writeQueue.then(() => this.upload.stream.write(snapData)).catch(() => {});
    }

    // ACK only when the entire body for this request is received
    if (isDone && !socket.destroyed) {
      const response = 'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n';
      socket.write(response, 'utf8', () => {
        if (!socket.destroyed) socket.end();
      });
    }

    // Finalize when last chunk of the ACTUAL FILE is received
    if ((isLast || (fileSize > 0 && this.upload.received >= fileSize)) && !this.upload.finalized) {
      if (!isDone) return; // Wait for full body before finalizing file move
      this.upload.finalized = true;
      this.upload.active = false;
      this.upload.writeQueue.then(async () => {
        if (this.upload.stream) { await this.upload.stream.close(); this.upload.stream = null; }
        try {
          if (await RNBlobUtil.fs.exists(finalPath)) await RNBlobUtil.fs.unlink(finalPath);
          await RNBlobUtil.fs.mv(tempPath, finalPath);
        } catch (_) {}
        this.report({ type: 'upload_progress', fileProgress: { name: fileName, percent: 100, sent: fileSize, total: fileSize } });
        this.report({ type: 'complete', message: `Received ${fileName}` });
      }).catch(() => {});
    }
  }

  public isRunning() {
    return this.server !== null;
  }

  private report(status: any) {
    if (this.statusCallback) this.statusCallback(status);
  }

  public updateFiles(newFiles: any[]) {
    newFiles.forEach(nf => {
      if (!this.filesToSend.find(f => f.name === nf.name && f.uri === nf.uri)) {
        this.filesToSend.push(nf);
      }
    });
  }

  public stop() {
    if (this.server) { this.server.close(); this.server = null; }
    this.activeSockets.forEach(s => { try { s.destroy(); } catch (_) {} });
    this.activeSockets.clear();
    DiscoveryManager.stopPublishing();
  }
}

const TransferServerInstance = new TransferServer();
export default TransferServerInstance;