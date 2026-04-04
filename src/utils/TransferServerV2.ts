import TcpSocket from 'react-native-tcp-socket';
import RNBlobUtil from 'react-native-blob-util';
import { Platform } from 'react-native';
import DiscoveryManager from './DiscoveryManager';
import { Buffer } from 'buffer';

/**
 * TransferServerV2.ts
 * 
 * Modern HTTP server for PC sharing that mirrors the V2 P2P experience.
 * Features:
 *  - Serves V2 Web UI (HTML5/JS)
 *  - Handles chunked multipart POST uploads from browser
 *  - Streams large files to browser via GET
 *  - Uses RNBlobUtil for reliable Android content path resolution
 */

export interface ServerStatusV2 {
  type: 'listening' | 'client_connected' | 'client_disconnected' | 'upload_progress' | 'download_progress' | 'complete' | 'error';
  port?: number;
  clientAddress?: string;
  message?: string;
  fileProgress?: { name: string; percent: number; sent: number; total: number; speed?: number };
}

const WEB_UI_V2 = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlashDrop - PC Transfer</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Outfit',sans-serif}
:root{--p:#2563EB;--pd:#1E40AF;--g:#10B981;--bg:#F8FAFC;--w:#fff;--t:#1E293B;--m:#64748B;--b:#E2E8F0;--acc:#6366F1}
body{background:var(--bg);color:var(--t);min-height:100vh;display:flex;flex-direction:column;overflow-x:hidden}
header{background:var(--w);padding:1rem 2rem;display:flex;justify-content:space-between;align-items:center;box-shadow:0 1px 3px rgba(0,0,0,.06);position:sticky;top:0;z-index:100}
.logo{font-size:1.4rem;font-weight:800;color:var(--p);display:flex;align-items:center;gap:.6rem}
.badge{background:#DCFCE7;color:#166534;padding:.3rem .8rem;border-radius:99px;font-size:.8rem;font-weight:600;display:flex;align-items:center;gap:.4rem}
.dot{width:7px;height:7px;background:#16a34a;border-radius:50%;animation:blink 1.5s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
main{flex:1;padding:2rem;max-width:1100px;margin:0 auto;width:100%;display:grid;grid-template-columns:1.2fr 1fr;gap:2rem}
.card{background:var(--w);border-radius:1.5rem;padding:2rem;border:1px solid var(--b);box-shadow:0 10px 25px -5px rgba(0,0,0,0.05)}
.card-header{margin-bottom:1.5rem}
.card-title{font-size:1.2rem;font-weight:800;color:var(--t);display:flex;align-items:center;gap:.6rem}
.card-sub{font-size:.9rem;color:var(--m);margin-top:.2rem}
.drop-zone{border:2px dashed var(--b);border-radius:1.25rem;padding:4rem 2rem;text-align:center;background:#FAFAFA;cursor:pointer;transition:all .3s cubic-bezier(0.4,0,0.2,1);position:relative;overflow:hidden}
.drop-zone:hover{border-color:var(--p);background:#F8FAFF}
.drop-zone.active{border-color:var(--acc);background:#EEF2FF;transform:scale(1.02)}
.dz-icon{font-size:3rem;margin-bottom:1rem;display:block}
.btn{background:var(--p);color:#fff;border:none;padding:.75rem 1.5rem;border-radius:.75rem;font-weight:700;font-size:.9rem;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:.5rem;box-shadow:0 4px 12px rgba(37,99,235,0.2)}
.btn:hover{background:var(--pd);transform:translateY(-1px);box-shadow:0 6px 15px rgba(37,99,235,0.3)}
.btn-sec{background:var(--w);color:var(--t);border:1px solid var(--b);box-shadow:none}
.btn-sec:hover{background:#F1F5F9;border-color:var(--m);box-shadow:none}
.up-list{margin-top:2rem;display:flex;flex-direction:column;gap:.75rem}
.up-item{background:#FFF;border:1px solid var(--b);border-radius:1rem;padding:1rem;display:flex;flex-direction:column;gap:.6rem;animation:slideIn .3s ease-out}
@keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.up-info{display:flex;justify-content:space-between;align-items:center}
.file-meta{min-width:0;flex:1}
.file-name{font-weight:700;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.file-size{font-size:.75rem;color:var(--m);margin-top:.1rem}
.up-prog{height:8px;background:#E2E8F0;border-radius:99px;overflow:hidden}
.up-fill{height:100%;background:linear-gradient(90deg,var(--p),var(--acc));width:0%;transition:width .4s;border-radius:99px}
.up-fill.done{background:var(--g)}
.file-grid{display:grid;grid-template-columns:1fr;gap:.75rem}
.dl-item{display:flex;align-items:center;gap:1rem;padding:1rem;background:#F8FAFC;border:1px solid var(--b);border-radius:1rem;transition:all .2s}
.dl-item:hover{border-color:var(--p);background:#FFF}
.dl-icon{width:2.75rem;height:2.75rem;background:#EEF2FF;color:var(--p);border-radius:.75rem;display:flex;align-items:center;justify-content:center;font-size:1.4rem}
.empty{text-align:center;padding:5rem 1rem;color:var(--m);opacity:.6}
.tab-bar{display:flex;gap:1.5rem;margin-bottom:1.5rem;border-bottom:1px solid var(--b)}
.tab{padding:.75rem 0;font-weight:700;font-size:.95rem;color:var(--m);cursor:pointer;position:relative}
.tab.active{color:var(--p)}
.tab.active::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:3px;background:var(--p);border-radius:99px}
@media(max-width:850px){main{grid-template-columns:1fr;padding:1rem}header{padding:1rem}}
</style>
</head>
<body>
<header>
  <div class="logo">⚡ FlashDrop</div>
  <div class="badge"><span class="dot"></span> <b>Mobile Sync</b></div>
</header>
<main>
  <section class="card">
    <div class="card-header">
      <div class="card-title">🚀 Send to Mobile</div>
      <div class="card-sub">Drag & drop large files (up to 4GB) to your phone</div>
    </div>
    <div class="drop-zone" id="dz" onclick="document.getElementById('fi').click()">
      <span class="dz-icon">📦</span>
      <div style="font-weight:800;font-size:1.1rem;margin-bottom:.4rem">Drop files or click to browse</div>
      <div style="font-size:.85rem;color:var(--m)">Fast local transfer • No Internet needed</div>
      <input type="file" id="fi" multiple hidden>
    </div>
    <div class="up-list" id="pl"></div>
  </section>
  <section class="card">
    <div class="card-header">
      <div class="card-title">📥 Available from Phone</div>
      <div class="card-sub">Files currently shared by your device</div>
    </div>
    <div class="file-grid" id="fl">
      <div class="empty">No files shared yet</div>
    </div>
  </section>
</main>
<script>
(function(){
  var dz=document.getElementById('dz'),fi=document.getElementById('fi'),pl=document.getElementById('pl'),fl=document.getElementById('fl');
  fi.onchange=function(){startFiles(fi.files);fi.value=''};
  dz.ondragover=function(e){e.preventDefault();dz.classList.add('active')};
  dz.ondragleave=function(){dz.classList.remove('active')};
  dz.ondrop=function(e){e.preventDefault();dz.classList.remove('active');startFiles(e.dataTransfer.files)};
  var q=[],busy=false;
  function startFiles(files){for(var i=0;i<files.length;i++){q.push(files[i]);addUI(files[i].name,files[i].size);}if(!busy)pump();}
  async function pump(){if(!q.length){busy=false;return;}busy=true;await send(q.shift());pump();}
  async function send(f){
    var tot=f.size,off=0,CH=4*1024*1024,id=rid(f.name);
    while(off<tot){
      var end=Math.min(off+CH,tot),last=(end>=tot)?1:0,blob=f.slice(off,end);
      var url='/api/upload?name='+encodeURIComponent(f.name)+'&size='+tot+'&offset='+off+'&last='+last;
      var ok=await fetch(url,{method:'POST',body:blob}).then(r=>r.ok).catch(()=>false);
      if(!ok){setErr(id);return;}
      off=end;setPct(id,last?100:Math.floor(off/tot*100),off,tot);
    }
  }
  function addUI(n,s){var id=rid(n);if(document.getElementById(id))return;var d=document.createElement('div');d.id=id;d.className='up-item';d.innerHTML='<div class="up-info"><div class="file-meta"><div class="file-name" title="'+esc(n)+'">'+esc(n)+'</div><div class="file-size" id="'+id+'_m">Preparing...</div></div><div id="'+id+'_p" style="font-weight:900;font-size:.9rem;color:var(--p)">0%</div></div><div class="up-prog"><div class="up-fill" id="'+id+'_f"></div></div>';pl.prepend(d);}
  function setPct(id,p,s,t){var f=document.getElementById(id+'_f'),pk=document.getElementById(id+'_p'),m=document.getElementById(id+'_m');if(f)f.style.width=p+'%';if(p>=100)f.classList.add('done');if(pk)pk.textContent=p>=100?'DONE':p+'%';if(m)m.textContent=fmt(s)+' / '+fmt(t);}
  function setErr(id){var pk=document.getElementById(id+'_p'),f=document.getElementById(id+'_f');if(pk)pk.textContent='FAILED';if(f)f.style.background='#EF4444';}
  function rid(n){return 'u_'+btoa(encodeURIComponent(n)).replace(/=/g,'');}
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;');}
  function fmt(b){if(!b)return '0 B';var k=1024,s=['B','KB','MB','GB'],i=Math.floor(Math.log(b)/Math.log(k));return (b/Math.pow(k,i)).toFixed(1)+' '+s[i];}
  async function load(){try{var r=await fetch('/api/files'),l=await r.json();fl.innerHTML=l.length?'':'<div class="empty">No files shared yet</div>';l.forEach(f=>{var d=document.createElement('div');d.className='dl-item';d.innerHTML='<div class="dl-icon">📁</div><div style="flex:1;min-width:0"><div class="file-name">'+esc(f.name)+'</div><div class="file-size">'+fmt(f.size)+'</div></div><a href="/api/download?name='+encodeURIComponent(f.name)+'" class="btn btn-sec" style="padding:.5rem .75rem">⬇️</a>';fl.appendChild(d);});}catch(e){}}
  load();setInterval(load,4000);
})();
</script>
</body>
</html>`;

class TransferServerV2 {
  private server: any = null;
  public onStatus: ((status: ServerStatusV2) => void) | null = null;
  private files: any[] = [];
  private sockets: Map<string, any> = new Map();
  private upload: any = { active: false, name: '', received: 0, stream: null, queue: Promise.resolve() };

  public start(port: number, sharedFiles: any[] = []) {
    if (this.server) {
      if (sharedFiles.length > 0) this.files = [...sharedFiles];
      this.emit({ type: 'listening', port });
      return;
    }
    this.files = sharedFiles;

    try {
      this.server = TcpSocket.createServer((socket: any) => {
        const ip = (socket.remoteAddress || 'unknown').replace('::ffff:', '');
        this.sockets.set(ip, socket);
        this.emit({ type: 'client_connected', clientAddress: ip });

        let bufList: Buffer[] = [], rxLen = 0, bodyMode = false, bodyLen = 0, currentReq: any = null, recvd = 0;

        socket.on('data', async (chunk: Buffer) => {
          if (!bodyMode) {
            bufList.push(chunk); rxLen += chunk.length;
            const fullBuf = Buffer.concat(bufList);
            const sep = fullBuf.indexOf('\r\n\r\n');
            if (sep === -1) return;

            const headers = fullBuf.slice(0, sep).toString();
            const bodyStartData = fullBuf.slice(sep + 4);
            bufList = []; rxLen = 0;

            const [line1] = headers.split('\r\n');
            const [method, path] = line1.split(' ');
            if (!method || !path) return;

            console.log(`[PC V2] ${method} ${path}`);
            const clMatch = headers.match(/Content-Length:\s*(\d+)/i);
            bodyLen = clMatch ? parseInt(clMatch[1], 10) : 0;
            currentReq = { method, path, headers };

            if (method === 'GET') {
              this.handleGet(socket, path);
            } else if (method === 'POST') {
              bodyMode = true; recvd = bodyStartData.length;
              const isDone = bodyLen > 0 && recvd >= bodyLen;
              if (path.startsWith('/api/upload')) {
                await this.handleUpload(socket, currentReq, bodyStartData, false, isDone);
                if (isDone) bodyMode = false;
              } else if (path.startsWith('/api/v2/handshake')) {
                 if (isDone) { this.emit({ type: 'client_connected', message: bodyStartData.toString() }); bodyMode = false; socket.end('HTTP/1.1 200 OK\r\n\r\n'); }
                 else { bufList = [bodyStartData]; }
              }
            }
          } else {
            recvd += chunk.length;
            if (currentReq?.path.startsWith('/api/upload')) {
              const isDone = recvd >= bodyLen;
              await this.handleUpload(socket, currentReq, chunk, true, isDone);
              if (isDone) bodyMode = false;
            } else if (currentReq?.path.startsWith('/api/v2/handshake')) {
               bufList.push(chunk);
               if (recvd >= bodyLen) {
                 const full = Buffer.concat(bufList);
                 this.emit({ type: 'client_connected', message: full.toString() });
                 bodyMode = false; bufList = [];
                 socket.end('HTTP/1.1 200 OK\r\n\r\n');
               }
            }
          }
        });

        socket.on('close', () => { this.sockets.delete(ip); this.emit({ type: 'client_disconnected', clientAddress: ip }); });
        socket.on('error', () => { this.sockets.delete(ip); });
      });

      this.server.listen({ port, host: '0.0.0.0' }, () => {
        this.emit({ type: 'listening', port });
        DiscoveryManager.publishService(port);
      });
    } catch (e: any) { this.emit({ type: 'error', message: e.message }); }
  }

  private handleGet(socket: any, path: string) {
    const cleanPath = path.split('?')[0];
    if (cleanPath === '/' || cleanPath === '/index.html') {
      const b = Buffer.from(WEB_UI_V2);
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${b.length}\r\nConnection: close\r\n\r\n${WEB_UI_V2}`);
      return;
    }
    if (cleanPath === '/api/files') {
      const data = JSON.stringify(this.files.map(f => ({ name: f.name, size: f.size })));
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(data)}\r\nConnection: close\r\n\r\n${data}`);
      return;
    }
    if (cleanPath === '/api/download') {
      this.handleDownload(socket, path);
      return;
    }
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
  }

  private async handleDownload(socket: any, path: string) {
    const name = decodeURIComponent(path.split('name=')[1]?.split('&')[0] || '');
    const f = this.files.find(x => x.name === name);
    if (!f) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }

    try {
      let uri = f.uri;
      if (Platform.OS === 'android' && uri.startsWith('content://')) {
        const tmp = `${RNBlobUtil.fs.dirs.CacheDir}/pc_dl_${Date.now()}`;
        await RNBlobUtil.fs.cp(uri, tmp);
        uri = tmp;
      }
      const stat = await RNBlobUtil.fs.stat(uri);
      socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="${encodeURIComponent(name)}"\r\nContent-Length: ${stat.size}\r\nConnection: close\r\n\r\n`);
      
      const stream = await RNBlobUtil.fs.readStream(uri, 'base64', 1024 * 1024);
      stream.onData((chunk) => { 
        if (!socket.destroyed) socket.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('base64'), 'base64');
      });
      stream.onEnd(() => { if (!socket.destroyed) socket.end(); if (uri.includes('pc_dl_')) RNBlobUtil.fs.unlink(uri).catch(() => {}); });
      stream.onError(() => { if (!socket.destroyed) socket.destroy(); if (uri.includes('pc_dl_')) RNBlobUtil.fs.unlink(uri).catch(() => {}); });
      stream.open();
    } catch (e) { if (!socket.destroyed) socket.end('HTTP/1.1 500 Server Error\r\n\r\n'); }
  }

  private async handleUpload(socket: any, req: any, chunk: Buffer, isCont: boolean, isDone: boolean) {
    const qs = req.path.split('?')[1] || '';
    const params: any = {};
    qs.split('&').forEach((p: string) => {
      const [k, v] = p.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });

    const name = params.name || 'file';
    const total = parseInt(params.size || '0', 10);
    const offset = parseInt(params.offset || '0', 10);
    const isLast = params.last === '1';

    const temp = `${RNBlobUtil.fs.dirs.CacheDir}/pc_up_${encodeURIComponent(name)}`;
    const dest = `${Platform.OS === 'android' ? RNBlobUtil.fs.dirs.DownloadDir : RNBlobUtil.fs.dirs.DocumentDir}/${name}`;

    if (offset === 0 && !isCont) {
      try { await RNBlobUtil.fs.unlink(temp); } catch(_) {}
      const s = await RNBlobUtil.fs.writeStream(temp, 'base64', false);
      this.upload = { active: true, name, total, received: 0, stream: s, queue: Promise.resolve() };
    }

    if (chunk.length > 0 && this.upload.stream) {
      this.upload.received += chunk.length;
      const data = chunk.toString('base64');
      this.upload.queue = this.upload.queue.then(() => this.upload.stream.write(data));
      this.emit({ type: 'upload_progress', fileProgress: { name, percent: Math.round(this.upload.received/total*100), sent: this.upload.received, total } });
    }

    if (isDone) {
      socket.end('HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\n\r\n');
      if (isLast || (total > 0 && offset + chunk.length >= total)) {
        this.upload.queue.then(async () => {
          if (this.upload.stream) { await this.upload.stream.close(); this.upload.stream = null; }
          try {
            if (await RNBlobUtil.fs.exists(dest)) await RNBlobUtil.fs.unlink(dest);
            await RNBlobUtil.fs.mv(temp, dest);
          } catch(_) {}
          this.emit({ type: 'complete', message: `Received ${name}` });
        }).catch(() => {});
      }
    }
  }

  private emit(status: ServerStatusV2) { if (this.onStatus) this.onStatus(status); }
  public updateFiles(f: any[]) { this.files = [...f]; }
  public stop() { if (this.server) { this.server.close(); this.server = null; } this.sockets.forEach(s => s.destroy()); this.sockets.clear(); DiscoveryManager.stopPublishing(); }
}

export default new TransferServerV2();
