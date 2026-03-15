import TcpSocket from 'react-native-tcp-socket';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import CryptoJS from 'crypto-js';
import { saveHistoryItem } from './HistoryService';
import DiscoveryManager from './DiscoveryManager';

export type ServerStatus = {
  type: 'client_connected' | 'progress' | 'upload_progress' | 'complete' | 'error';
  clientAddress?: string;
  fileProgress?: {
    name: string;
    percent: number;
    sent: number;
    total: number;
    speed?: number;    // bytes/sec
    etaSecs?: number;
  };
  message?: string;
};

// ─── Wall-clock speed tracker ────────────────────────────────────────────────
// Simple, accurate, same formula used on both sender and receiver so both
// devices show the same number.
class SpeedTracker {
  private t0 = 0;
  private b0 = 0;
  private on = false;

  begin(bytes: number) { this.t0 = Date.now(); this.b0 = bytes; this.on = true; }

  sample(bytes: number, total: number): { speed: number; etaSecs: number } {
    if (!this.on) return { speed: 0, etaSecs: 0 };
    const dt = (Date.now() - this.t0) / 1000;
    if (dt < 0.3) return { speed: 0, etaSecs: 0 };
    const speed = Math.round((bytes - this.b0) / dt);
    const remaining = total - bytes;
    const etaSecs = speed > 0 && remaining > 0 ? Math.round(remaining / speed) : 0;
    return { speed, etaSecs };
  }

  reset() { this.on = false; }
}

export class TransferServer {
  server: any = null;
  filesToSend: any[] = [];
  statusCallback?: (status: ServerStatus) => void;
  private currentPort = 8888;
  private connectedClients = new Set<string>();
  private peerIp: string | null = null;
  private peerServerPort = 8888;
  private peerRegisteredCb?: (ip: string, port: number) => void;
  private secretKey?: string;

  // Active upload state
  private upload = {
    active: false,
    finalized: false,
    fileName: '',
    fileSize: 0,
    received: 0,
    tempPath: '',
    finalPath: '',
    writeQueue: Promise.resolve() as Promise<void>,
    tracker: new SpeedTracker(),
  };

  private readonly PAGE_B64 = 'PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9IlVURi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjAiPgo8dGl0bGU+Rmxhc2hEcm9wIC0gUEMgQ29ubmVjdDwvdGl0bGU+CjxsaW5rIGhyZWY9Imh0dHBzOi8vZm9udHMuZ29vZ2xlYXBpcy5jb20vY3NzMj9mYW1pbHk9T3V0Zml0OndnaHRAMzAwOzQwMDs2MDA7ODAwJmRpc3BsYXk9c3dhcCIgcmVsPSJzdHlsZXNoZWV0Ij4KPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBocmVmPSJodHRwczovL2NkbmpzLmNsb3VkZmxhcmUuY29tL2FqYXgvbGlicy9mb250LWF3ZXNvbWUvNi40LjAvY3NzL2FsbC5taW4uY3NzIj4KPHN0eWxlPgoqIHsgbWFyZ2luOiAwOyBwYWRkaW5nOiAwOyBib3gtc2l6aW5nOiBib3JkZXItYm94OyBmb250LWZhbWlseTogJ091dGZpdCcsIHNhbnMtc2VyaWY7IH0KOnJvb3QgeyAtLXByaW1hcnk6ICMyNTYzRUI7IC0tcHJpbWFyeS1kYXJrOiAjMUU0MEFGOyAtLWdyZWVuOiAjMTBCOTgxOyAtLWJnOiAjRjhGQUZDOyAtLXdoaXRlOiAjZmZmOyAtLXRleHQ6ICMxRTI5M0I7IC0tbXV0ZWQ6ICM2NDc0OEI7IC0tYm9yZGVyOiAjRTJFOEYwOyB9CmJvZHkgeyBiYWNrZ3JvdW5kOiB2YXIoLS1iZyk7IGNvbG9yOiB2YXIoLS10ZXh0KTsgbWluLWhlaWdodDogMTAwdmg7IGRpc3BsYXk6IGZsZXg7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47IH0KaGVhZGVyIHsgYmFja2dyb3VuZDogdmFyKC0td2hpdGUpOyBwYWRkaW5nOiAxcmVtIDJyZW07IGRpc3BsYXk6IGZsZXg7IGp1c3RpZnktY29udGVudDogc3BhY2UtYmV0d2VlbjsgYWxpZ24taXRlbXM6IGNlbnRlcjsgYm94LXNoYWRvdzogMCAxcHggM3B4IHJnYmEoMCwwLDAsLjA2KTsgcG9zaXRpb246IHN0aWNreTsgdG9wOiAwOyB6LWluZGV4OiAxMDsgfQoubG9nbyB7IGZvbnQtc2l6ZTogMS40cmVtOyBmb250LXdlaWdodDogODAwOyBjb2xvcjogdmFyKC0tcHJpbWFyeSk7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogLjVyZW07IH0KLmJhZGdlIHsgYmFja2dyb3VuZDogI0RDRkNFNzsgY29sb3I6ICMxNjY1MzQ7IHBhZGRpbmc6IC4yNXJlbSAuNzVyZW07IGJvcmRlci1yYWRpdXM6IDk5cHg7IGZvbnQtc2l6ZTogLjhyZW07IGZvbnQtd2VpZ2h0OiA2MDA7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogLjRyZW07IH0KLmRvdCB7IHdpZHRoOiA3cHg7IGhlaWdodDogN3B4OyBiYWNrZ3JvdW5kOiAjMTZhMzRhOyBib3JkZXItcmFkaXVzOiA1MCU7IGFuaW1hdGlvbjogYmxpbmsgMS41cyBpbmZpbml0ZTsgfQpAa2V5ZnJhbWVzIGJsaW5rIHsgMCUsMTAwJXtvcGFjaXR5OjF9IDUwJXtvcGFjaXR5Oi4zfSB9Cm1haW4geyBmbGV4OiAxOyBwYWRkaW5nOiAycmVtOyBtYXgtd2lkdGg6IDExMDBweDsgbWFyZ2luOiAwIGF1dG87IHdpZHRoOiAxMDAlOyBkaXNwbGF5OiBncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmciAxZnI7IGdhcDogMS41cmVtOyB9Ci5jYXJkIHsgYmFja2dyb3VuZDogdmFyKC0td2hpdGUpOyBib3JkZXItcmFkaXVzOiAxLjI1cmVtOyBwYWRkaW5nOiAxLjc1cmVtOyBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpOyBib3gtc2hhZG93OiAwIDJweCA4cHggcmdiYSgwLDAsMCwuMDQpOyB9Ci5jYXJkLXRpdGxlIHsgZm9udC1zaXplOiAxLjFyZW07IGZvbnQtd2VpZ2h0OiA3MDA7IG1hcmdpbi1ib3R0b206IC4yNXJlbTsgfQouY2FyZC1zdWIgeyBmb250LXNpemU6IC44NXJlbTsgY29sb3I6IHZhcigtLW11dGVkKTsgbWFyZ2luLWJvdHRvbTogMS4yNXJlbTsgfQouZHJvcHpvbmUgeyBib3JkZXI6IDJweCBkYXNoZWQgdmFyKC0tYm9yZGVyKTsgYm9yZGVyLXJhZGl1czogMXJlbTsgcGFkZGluZzogMi41cmVtIDFyZW07IHRleHQtYWxpZ246IGNlbnRlcjsgYmFja2dyb3VuZDogI0ZBRkFGQTsgY3Vyc29yOiBwb2ludGVyOyB0cmFuc2l0aW9uOiBhbGwgLjJzOyB9Ci5kcm9wem9uZS5vdmVyIHsgYm9yZGVyLWNvbG9yOiB2YXIoLS1wcmltYXJ5KTsgYmFja2dyb3VuZDogI0VGRjZGRjsgfQouZHotaWNvbiB7IGZvbnQtc2l6ZTogMi4ycmVtOyBjb2xvcjogdmFyKC0tbXV0ZWQpOyBtYXJnaW4tYm90dG9tOiAuNzVyZW07IH0KLmR6LXRpdGxlIHsgZm9udC13ZWlnaHQ6IDYwMDsgZm9udC1zaXplOiAuOTVyZW07IG1hcmdpbi1ib3R0b206IC4yNXJlbTsgfQouZHotc3ViIHsgZm9udC1zaXplOiAuOHJlbTsgY29sb3I6IHZhcigtLW11dGVkKTsgfQouYnRuIHsgYmFja2dyb3VuZDogdmFyKC0tcHJpbWFyeSk7IGNvbG9yOiAjZmZmOyBib3JkZXI6IG5vbmU7IHBhZGRpbmc6IC42cmVtIDEuMjVyZW07IGJvcmRlci1yYWRpdXM6IC42cmVtOyBmb250LXdlaWdodDogNjAwOyBmb250LXNpemU6IC44NXJlbTsgY3Vyc29yOiBwb2ludGVyOyB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kIC4yczsgZGlzcGxheTogaW5saW5lLWZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogLjRyZW07IH0KLmJ0bjpob3ZlciB7IGJhY2tncm91bmQ6IHZhcigtLXByaW1hcnktZGFyayk7IH0KLmJ0bi1vdXRsaW5lIHsgYmFja2dyb3VuZDogI2ZmZjsgY29sb3I6IHZhcigtLXRleHQpOyBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpOyB9Ci5idG4tb3V0bGluZTpob3ZlciB7IGJhY2tncm91bmQ6ICNGMUY1Rjk7IH0KLnByb2ctbGlzdCB7IG1hcmdpbi10b3A6IDFyZW07IGRpc3BsYXk6IGZsZXg7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47IGdhcDogLjZyZW07IH0KLnByb2ctaXRlbSB7IGJhY2tncm91bmQ6ICNGOEZBRkM7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7IGJvcmRlci1yYWRpdXM6IC43NXJlbTsgcGFkZGluZzogLjc1cmVtOyB9Ci5wcm9nLW5hbWUgeyBmb250LXNpemU6IC44MnJlbTsgZm9udC13ZWlnaHQ6IDYwMDsgbWFyZ2luLWJvdHRvbTogLjRyZW07IHdoaXRlLXNwYWNlOiBub3dyYXA7IG92ZXJmbG93OiBoaWRkZW47IHRleHQtb3ZlcmZsb3c6IGVsbGlwc2lzOyB9Ci5wcm9nLXRyYWNrIHsgYmFja2dyb3VuZDogI0UyRThGMDsgYm9yZGVyLXJhZGl1czogOTlweDsgaGVpZ2h0OiA2cHg7IG92ZXJmbG93OiBoaWRkZW47IH0KLnByb2ctZmlsbCB7IGhlaWdodDogMTAwJTsgYmFja2dyb3VuZDogdmFyKC0tcHJpbWFyeSk7IGJvcmRlci1yYWRpdXM6IDk5cHg7IHdpZHRoOiAwJTsgdHJhbnNpdGlvbjogd2lkdGggLjNzOyB9Ci5wcm9nLWZpbGwuZG9uZSB7IGJhY2tncm91bmQ6IHZhcigtLWdyZWVuKTsgfQoucHJvZy1tZXRhIHsgZGlzcGxheTogZmxleDsganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuOyBmb250LXNpemU6IC43NXJlbTsgY29sb3I6IHZhcigtLW11dGVkKTsgbWFyZ2luLXRvcDogLjNyZW07IH0KLmZpbGUtbGlzdCB7IGRpc3BsYXk6IGZsZXg7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47IGdhcDogLjZyZW07IH0KLmZpbGUtaXRlbSB7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogLjc1cmVtOyBwYWRkaW5nOiAuNzVyZW07IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7IGJvcmRlci1yYWRpdXM6IC43NXJlbTsgfQouZmlsZS1pY29uIHsgd2lkdGg6IDIuMnJlbTsgaGVpZ2h0OiAyLjJyZW07IGJhY2tncm91bmQ6ICNFRkY2RkY7IGNvbG9yOiB2YXIoLS1wcmltYXJ5KTsgYm9yZGVyLXJhZGl1czogLjVyZW07IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGp1c3RpZnktY29udGVudDogY2VudGVyOyBmb250LXNpemU6IC45cmVtOyBmbGV4LXNocmluazogMDsgfQouZmlsZS1pbmZvIHsgZmxleDogMTsgbWluLXdpZHRoOiAwOyB9Ci5maWxlLW5hbWUgeyBmb250LXdlaWdodDogNjAwOyBmb250LXNpemU6IC44NXJlbTsgd2hpdGUtc3BhY2U6IG5vd3JhcDsgb3ZlcmZsb3c6IGhpZGRlbjsgdGV4dC1vdmVyZmxvdzogZWxsaXBzaXM7IH0KLmZpbGUtc2l6ZSB7IGZvbnQtc2l6ZTogLjc1cmVtOyBjb2xvcjogdmFyKC0tbXV0ZWQpOyB9Ci5lbXB0eSB7IHRleHQtYWxpZ246IGNlbnRlcjsgcGFkZGluZzogMi41cmVtIDFyZW07IGNvbG9yOiB2YXIoLS1tdXRlZCk7IH0KLmVtcHR5IGkgeyBmb250LXNpemU6IDJyZW07IG9wYWNpdHk6IC4zOyBkaXNwbGF5OiBibG9jazsgbWFyZ2luLWJvdHRvbTogLjVyZW07IH0KQG1lZGlhIChtYXgtd2lkdGg6IDcwMHB4KSB7IG1haW4geyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmcjsgcGFkZGluZzogMXJlbTsgfSB9Cjwvc3R5bGU+CjwvaGVhZD4KPGJvZHk+CjxoZWFkZXI+CiAgPGRpdiBjbGFzcz0ibG9nbyI+PGkgY2xhc3M9ImZhLXNvbGlkIGZhLWJvbHQiPjwvaT4gRmxhc2hEcm9wPC9kaXY+CiAgPGRpdiBjbGFzcz0iYmFkZ2UiPjxzcGFuIGNsYXNzPSJkb3QiPjwvc3Bhbj4gQ29ubmVjdGVkPC9kaXY+CjwvaGVhZGVyPgo8bWFpbj4KICA8c2VjdGlvbiBjbGFzcz0iY2FyZCI+CiAgICA8ZGl2IGNsYXNzPSJjYXJkLXRpdGxlIj5TZW5kIHRvIFBob25lPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJjYXJkLXN1YiI+U2VsZWN0IG9yIGRyYWcgZmlsZXMgdG8gdHJhbnNmZXIgdG8geW91ciBtb2JpbGUgZGV2aWNlPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJkcm9wem9uZSIgaWQ9ImRyb3B6b25lIj4KICAgICAgPGRpdiBjbGFzcz0iZHotaWNvbiI+PGkgY2xhc3M9ImZhLXNvbGlkIGZhLWNsb3VkLWFycm93LXVwIj48L2k+PC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9ImR6LXRpdGxlIj5Ecm9wIGZpbGVzIGhlcmU8L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iZHotc3ViIiBzdHlsZT0ibWFyZ2luLWJvdHRvbTouNzVyZW0iPm9yIGNsaWNrIHRoZSBidXR0b24gYmVsb3c8L2Rpdj4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYnRuIiBpZD0ic2VsZWN0QnRuIj48aSBjbGFzcz0iZmEtc29saWQgZmEtZm9sZGVyLW9wZW4iPjwvaT4gU2VsZWN0IEZpbGVzPC9idXR0b24+CiAgICAgIDxpbnB1dCB0eXBlPSJmaWxlIiBpZD0iZmlsZUlucHV0IiBtdWx0aXBsZSBoaWRkZW4+CiAgICA8L2Rpdj4KICAgIDxkaXYgY2xhc3M9InByb2ctbGlzdCIgaWQ9InByb2dMaXN0Ij48L2Rpdj4KICA8L3NlY3Rpb24+CiAgPHNlY3Rpb24gY2xhc3M9ImNhcmQiPgogICAgPGRpdiBjbGFzcz0iY2FyZC10aXRsZSI+UmVjZWl2ZSBmcm9tIFBob25lPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJjYXJkLXN1YiI+RmlsZXMgc2hhcmVkIGZyb20geW91ciBwaG9uZSBhcHBlYXIgaGVyZSBmb3IgZG93bmxvYWQ8L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImZpbGUtbGlzdCIgaWQ9ImZpbGVMaXN0Ij4KICAgICAgPGRpdiBjbGFzcz0iZW1wdHkiPjxpIGNsYXNzPSJmYS1yZWd1bGFyIGZhLWZvbGRlci1vcGVuIj48L2k+Tm8gZmlsZXMgc2hhcmVkIHlldDwvZGl2PgogICAgPC9kaXY+CiAgPC9zZWN0aW9uPgo8L21haW4+CjxzY3JpcHQ+CihmdW5jdGlvbiAoKSB7CiAgdmFyIGRyb3B6b25lICAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZHJvcHpvbmUnKTsKICB2YXIgZmlsZUlucHV0ICA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmaWxlSW5wdXQnKTsKICB2YXIgc2VsZWN0QnRuICA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZWxlY3RCdG4nKTsKICB2YXIgcHJvZ0xpc3QgICA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwcm9nTGlzdCcpOwogIHZhciBmaWxlTGlzdEVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZpbGVMaXN0Jyk7CiAgc2VsZWN0QnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgZnVuY3Rpb24gKGUpIHsgZS5zdG9wUHJvcGFnYXRpb24oKTsgZmlsZUlucHV0LmNsaWNrKCk7IH0pOwogIGZpbGVJbnB1dC5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7IHN0YXJ0VXBsb2FkcyhmaWxlSW5wdXQuZmlsZXMpOyBmaWxlSW5wdXQudmFsdWUgPSAnJzsgfSk7CiAgZHJvcHpvbmUuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGZpbGVJbnB1dC5jbGljaygpOyB9KTsKICBkcm9wem9uZS5hZGRFdmVudExpc3RlbmVyKCdkcmFnb3ZlcicsIGZ1bmN0aW9uIChlKSB7IGUucHJldmVudERlZmF1bHQoKTsgZHJvcHpvbmUuY2xhc3NMaXN0LmFkZCgnb3ZlcicpOyB9KTsKICBkcm9wem9uZS5hZGRFdmVudExpc3RlbmVyKCdkcmFnbGVhdmUnLCBmdW5jdGlvbiAoKSB7IGRyb3B6b25lLmNsYXNzTGlzdC5yZW1vdmUoJ292ZXInKTsgfSk7CiAgZHJvcHpvbmUuYWRkRXZlbnRMaXN0ZW5lcignZHJvcCcsIGZ1bmN0aW9uIChlKSB7IGUucHJldmVudERlZmF1bHQoKTsgZHJvcHpvbmUuY2xhc3NMaXN0LnJlbW92ZSgnb3ZlcicpOyBzdGFydFVwbG9hZHMoZS5kYXRhVHJhbnNmZXIuZmlsZXMpOyB9KTsKICB2YXIgdXBsb2FkUXVldWUgPSBbXSwgdXBsb2FkaW5nID0gZmFsc2U7CiAgZnVuY3Rpb24gc3RhcnRVcGxvYWRzKGZpbGVzKSB7IGZvciAodmFyIGkgPSAwOyBpIDwgZmlsZXMubGVuZ3RoOyBpKyspIHsgdXBsb2FkUXVldWUucHVzaChmaWxlc1tpXSk7IGNyZWF0ZVByb2dSb3coZmlsZXNbaV0ubmFtZSwgZmlsZXNbaV0uc2l6ZSk7IH0gaWYgKCF1cGxvYWRpbmcpIHByb2Nlc3NRdWV1ZSgpOyB9CiAgYXN5bmMgZnVuY3Rpb24gcHJvY2Vzc1F1ZXVlKCkgeyBpZiAoIXVwbG9hZFF1ZXVlLmxlbmd0aCkgeyB1cGxvYWRpbmcgPSBmYWxzZTsgcmV0dXJuOyB9IHVwbG9hZGluZyA9IHRydWU7IHZhciBmaWxlID0gdXBsb2FkUXVldWUuc2hpZnQoKTsgYXdhaXQgdXBsb2FkRmlsZShmaWxlKTsgcHJvY2Vzc1F1ZXVlKCk7IH0KICBhc3luYyBmdW5jdGlvbiB1cGxvYWRGaWxlKGZpbGUpIHsKICAgIHZhciB0b3RhbCA9IGZpbGUuc2l6ZSwgb2Zmc2V0ID0gMDsKICAgIHZhciBDSFVOS19TSVpFID0gOCAqIDEwMjQgKiAxMDI0OyAvLyA4TUIgY2h1bmtzIGZvciBtYXggdGhyb3VnaHB1dAogICAgc2V0UHJvZ3Jlc3MoZmlsZS5uYW1lLCAwLCAwLCB0b3RhbCk7CiAgICB3aGlsZSAob2Zmc2V0IDwgdG90YWwpIHsKICAgICAgdmFyIGVuZCA9IE1hdGgubWluKG9mZnNldCArIENIVU5LX1NJWkUsIHRvdGFsKTsKICAgICAgdmFyIGlzTGFzdCA9IChlbmQgPj0gdG90YWwpID8gMSA6IDA7CiAgICAgIHZhciBibG9iID0gZmlsZS5zbGljZShvZmZzZXQsIGVuZCk7CiAgICAgIHZhciB1cmwgPSAnL2FwaS91cGxvYWQ/bmFtZT0nICsgZW5jb2RlVVJJQ29tcG9uZW50KGZpbGUubmFtZSkgKyAnJnNpemU9JyArIHRvdGFsICsgJyZvZmZzZXQ9JyArIG9mZnNldCArICcmbGFzdD0nICsgaXNMYXN0OwogICAgICB2YXIgb2sgPSBhd2FpdCBzZW5kQ2h1bmsodXJsLCBibG9iLCBmaWxlLm5hbWUsIG9mZnNldCwgdG90YWwpOwogICAgICBpZiAoIW9rKSB7IHNldEVycm9yKGZpbGUubmFtZSk7IHJldHVybjsgfQogICAgICBvZmZzZXQgPSBlbmQ7CiAgICAgIHNldFByb2dyZXNzKGZpbGUubmFtZSwgaXNMYXN0ID8gMTAwIDogTWF0aC5mbG9vcigob2Zmc2V0IC8gdG90YWwpICogMTAwKSwgb2Zmc2V0LCB0b3RhbCk7CiAgICB9CiAgfQogIGZ1bmN0aW9uIHNlbmRDaHVuayh1cmwsIGJsb2IsIG5hbWUsIGN1cnJlbnRPZmZzZXQsIHRvdGFsU2l6ZSkgewogICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlKSB7CiAgICAgIHZhciB4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTsgeGhyLnRpbWVvdXQgPSAwOwogICAgICB4aHIudXBsb2FkLmFkZEV2ZW50TGlzdGVuZXIoJ3Byb2dyZXNzJywgZnVuY3Rpb24oZSkgeyBpZiAoZS5sZW5ndGhDb21wdXRhYmxlKSB7IHZhciBzID0gY3VycmVudE9mZnNldCArIGUubG9hZGVkOyBzZXRQcm9ncmVzcyhuYW1lLCBNYXRoLmZsb29yKHMgLyB0b3RhbFNpemUgKiAxMDApLCBzLCB0b3RhbFNpemUpOyB9IH0pOwogICAgICB4aHIub25sb2FkID0gZnVuY3Rpb24oKSB7IHJlc29sdmUoeGhyLnN0YXR1cyA9PT0gMjAwKTsgfTsgeGhyLm9uZXJyb3IgPSBmdW5jdGlvbigpIHsgcmVzb2x2ZShmYWxzZSk7IH07IHhoci5vbnRpbWVvdXQgPSBmdW5jdGlvbigpIHsgcmVzb2x2ZShmYWxzZSk7IH07CiAgICAgIHhoci5vcGVuKCdQT1NUJywgdXJsKTsgeGhyLnNlbmQoYmxvYik7CiAgICB9KTsKICB9CiAgZnVuY3Rpb24gY3JlYXRlUHJvZ1JvdyhuYW1lLCB0b3RhbEJ5dGVzKSB7IHZhciBpZCA9IHJvd0lkKG5hbWUpOyBpZiAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpKSByZXR1cm47IHZhciByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsgcm93LmlkID0gaWQ7IHJvdy5jbGFzc05hbWUgPSAncHJvZy1pdGVtJzsgcm93LmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPSJwcm9nLW5hbWUiIHRpdGxlPSInICsgZXNjKG5hbWUpICsgJyI+JyArIGVzYyhuYW1lKSArICc8L2Rpdj48ZGl2IGNsYXNzPSJwcm9nLXRyYWNrIj48ZGl2IGNsYXNzPSJwcm9nLWZpbGwiIGlkPSInICsgaWQgKyAnX2YiPjwvZGl2PjwvZGl2PjxkaXYgY2xhc3M9InByb2ctbWV0YSI+PHNwYW4gaWQ9IicgKyBpZCArICdfcCI+MCU8L3NwYW4+PHNwYW4gaWQ9IicgKyBpZCArICdfc2kiPjAgLyAnICsgZm10KHRvdGFsQnl0ZXMpICsgJzwvc3Bhbj48L2Rpdj4nOyBwcm9nTGlzdC5hcHBlbmRDaGlsZChyb3cpOyB9CiAgZnVuY3Rpb24gc2V0UHJvZ3Jlc3MobmFtZSwgcGN0LCBzZW50LCB0b3RhbCkgeyB2YXIgaWQgPSByb3dJZChuYW1lKTsgdmFyIGZpbGwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCArICdfZicpOyB2YXIgcGN0RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCArICdfcCcpOyB2YXIgc2l6ZUVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQgKyAnX3NpJyk7IGlmIChmaWxsKSB7IGZpbGwuc3R5bGUud2lkdGggPSBwY3QgKyAnJSc7IGlmIChwY3QgPj0gMTAwKSBmaWxsLmNsYXNzTGlzdC5hZGQoJ2RvbmUnKTsgfSBpZiAocGN0RWwpIHBjdEVsLnRleHRDb250ZW50ID0gcGN0ID49IDEwMCA/ICdEb25lIScgOiBwY3QgKyAnJSc7IGlmIChzaXplRWwpIHNpemVFbC50ZXh0Q29udGVudCA9IGZtdChzZW50KSArICcgLyAgJyArIGZtdCh0b3RhbCk7IH0KICBmdW5jdGlvbiBzZXRFcnJvcihuYW1lKSB7IHZhciBpZCA9IHJvd0lkKG5hbWUpOyB2YXIgZiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkICsgJ19mJyk7IHZhciBwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQgKyAnX3AnKTsgaWYgKGYpIGYuc3R5bGUuYmFja2dyb3VuZCA9ICcjRUY0NDQ0JzsgaWYgKHApIHAudGV4dENvbnRlbnQgPSAnRmFpbGVkJzsgfQogIGZ1bmN0aW9uIHJvd0lkKG4pIHsgcmV0dXJuICdyb3dfJyArIG4ucmVwbGFjZSgvW15hLXpBLVowLTldL2csICdfJyk7IH0KICBmdW5jdGlvbiBlc2MocykgeyByZXR1cm4gcy5yZXBsYWNlKC8mL2csJyZhbXA7JykucmVwbGFjZSgvPC9nLCcmbHQ7JykucmVwbGFjZSgvPi9nLCcmZ3Q7JykucmVwbGFjZSgvIi9nLCcmcXVvdDsnKTsgfQogIGFzeW5jIGZ1bmN0aW9uIGxvYWRGaWxlcygpIHsgdHJ5IHsgdmFyIHJlcyA9IGF3YWl0IGZldGNoKCcvYXBpL2ZpbGVzJyk7IHZhciBmaWxlcyA9IGF3YWl0IHJlcy5qc29uKCk7IGZpbGVMaXN0RWwuaW5uZXJIVE1MID0gJyc7IGlmICghZmlsZXMubGVuZ3RoKSB7IGZpbGVMaXN0RWwuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9ImVtcHR5Ij48aSBjbGFzcz0iZmEtcmVndWxhciBmYS1mb2xkZXItb3BlbiI+PC9pPk5vIGZpbGVzIHNoYXJlZCB5ZXQ8L2Rpdj4nOyByZXR1cm47IH0gZmlsZXMuZm9yRWFjaChmdW5jdGlvbihmKSB7IHZhciBpdGVtID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IGl0ZW0uY2xhc3NOYW1lID0gJ2ZpbGUtaXRlbSc7IGl0ZW0uaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9ImZpbGUtaWNvbiI+PGkgY2xhc3M9ImZhLXNvbGlkIGZhLWZpbGUiPjwvaT48L2Rpdj48ZGl2IGNsYXNzPSJmaWxlLWluZm8iPjxkaXYgY2xhc3M9ImZpbGUtbmFtZSIgdGl0bGU9IicgKyBlc2MoZi5uYW1lKSArICciPicgKyBlc2MoZi5uYW1lKSArICc8L2Rpdj48ZGl2IGNsYXNzPSJmaWxlLXNpemUiPicgKyBmbXQoZi5zaXplKSArICc8L2Rpdj48L2Rpdj48YSBocmVmPSIvYXBpL2Rvd25sb2FkP25hbWU9JyArIGVuY29kZVVSSUNvbXBvbmVudChmLm5hbWUpICsgJyIgY2xhc3M9ImJ0biBidG4tb3V0bGluZSIgc3R5bGU9InRleHQtZGVjb3JhdGlvbjpub25lO3BhZGRpbmc6LjVyZW0gLjc1cmVtIj48aSBjbGFzcz0iZmEtc29saWQgZmEtZG93bmxvYWQiPjwvaT48L2E+JzsgZmlsZUxpc3RFbC5hcHBlbmRDaGlsZChpdGVtKTsgfSk7IH0gY2F0Y2goZSkge30gfQogIGZ1bmN0aW9uIGZtdChiKSB7IGlmICh0eXBlb2YgYiAhPT0gJ251bWJlcicgfHwgIWIpIHJldHVybiAnMCBCJzsgdmFyIGsgPSAxMDI0LCB1ID0gWydCJywnS0InLCdNQicsJ0dCJ10sIGkgPSBNYXRoLmZsb29yKE1hdGgubG9nKGIpL01hdGgubG9nKGspKTsgcmV0dXJuIChiL01hdGgucG93KGssaSkpLnRvRml4ZWQoaT8xOjApKycgJyt1W2ldOyB9CiAgbG9hZEZpbGVzKCk7IHNldEludGVydmFsKGxvYWRGaWxlcywgNDAwMCk7Cn0pKCk7Cjwvc2NyaXB0PjwvYm9keT48L2h0bWw+';

  private getPage() { return Buffer.from(this.PAGE_B64, 'base64').toString('utf-8'); }

  private async saveToDownloads(tempPath: string, finalPath: string, fileName: string) {
    const dir = Platform.OS === 'android' ? RNFS.DownloadDirectoryPath : RNFS.DocumentDirectoryPath;
    let dest = finalPath;
    if (await RNFS.exists(dest)) {
      try { await RNFS.unlink(dest); } catch (_) {
        const dot = fileName.lastIndexOf('.');
        dest = `${dir}/${dot > 0 ? fileName.slice(0, dot) : fileName}_${Date.now()}${dot > 0 ? fileName.slice(dot) : ''}`;
      }
    }
    // moveFile = atomic rename — zero-copy, no double-write
    await RNFS.moveFile(tempPath, dest);
    return dest;
  }

  private emitProgress(name: string, sent: number, total: number, type: 'upload_progress' | 'progress', tracker: SpeedTracker) {
    if (!this.statusCallback) return;
    const percent = total > 0 ? Math.min(Math.round((sent / total) * 100), 100) : 0;
    const { speed, etaSecs } = tracker.sample(sent, total);
    this.statusCallback({ type, fileProgress: { name, percent, sent, total, speed, etaSecs } });
  }

  // ─── Core pipe: reads file in 4MB chunks, writes raw binary to socket ────────
  // NO base64 kept in memory after decode. NO setTimeout yields.
  // Blocks on TCP drain ONLY when the kernel send-buffer is actually full.
  private async pipeToSocket(
    socket: any,
    readPath: string,
    fileSize: number,
    startByte: number,
    endByte: number,
    label: string,
    tracker: SpeedTracker,
    encrypted = false,
  ) {
    const CHUNK = encrypted ? 256 * 1024 : 4 * 1024 * 1024;
    let offset = startByte;
    let lastReport = startByte;
    tracker.begin(startByte);

    while (offset <= endByte && !socket.destroyed) {
      const cs = Math.min(CHUNK, endByte - offset + 1);
      const b64 = await RNFS.read(readPath, cs, offset, 'base64');

      let data: Buffer;
      if (encrypted) {
        const key = CryptoJS.SHA256(this.secretKey!);
        const iv = CryptoJS.enc.Hex.parse(key.toString().substring(0, 32));
        data = Buffer.from(CryptoJS.AES.encrypt(b64, key, { iv }).toString(), 'base64');
      } else {
        // Decode base64 → raw bytes in one call — fastest path
        data = Buffer.from(b64, 'base64');
      }

      if (socket.destroyed) break;

      const canContinue = socket.write(data);
      offset += cs;

      // Wait for drain ONLY if TCP send-buffer full — does NOT add artificial delay
      if (!canContinue && !socket.destroyed) {
        await new Promise<void>(resolve => {
          const onDrain = () => { clearTimeout(guard); resolve(); };
          const guard = setTimeout(() => { socket.removeListener('drain', onDrain); resolve(); }, 15000);
          socket.once('drain', onDrain);
        });
      }

      // Emit progress every 512KB so UI bar moves smoothly
      if (offset - lastReport >= 512 * 1024 || offset > endByte) {
        lastReport = offset;
        this.emitProgress(label, offset, fileSize, 'progress', tracker);
      }
    }
  }

  start(port = 8888, files: any[] = [], onStatus?: (status: ServerStatus) => void, secretKey?: string) {
    this.currentPort = port;
    this.filesToSend = files;
    if (onStatus !== undefined) this.statusCallback = onStatus;
    this.secretKey = secretKey;
    if (this.server) return { port };

    this.server = TcpSocket.createServer((socket: any) => {
      try { socket.setKeepAlive(true); } catch (_) { }   // no delay param — RN tcp-socket ignores it
      try { socket.setNoDelay(true); } catch (_) { }

      const addr: any = socket.address();
      const clientIp = typeof addr === 'string' ? addr : (addr?.address ?? 'unknown');
      if (!this.connectedClients.has(clientIp)) {
        this.connectedClients.add(clientIp);
        this.statusCallback?.({ type: 'client_connected', clientAddress: clientIp });
      }

      // HTTP parser — accumulates TCP chunks until a full request is ready
      let rxBufs: Buffer[] = [];
      let rxLen = 0;
      const SEP = Buffer.from('\r\n\r\n');
      let chain = Promise.resolve();

      socket.on('data', (raw: Buffer | string) => {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string, 'binary');
        rxBufs.push(chunk); rxLen += chunk.length;
        parse();
      });

      const parse = () => {
        if (socket.destroyed) return;
        // Consolidate buffers into one for indexOf scanning
        const buf = rxBufs.length > 1 ? (() => { const b = Buffer.concat(rxBufs, rxLen); rxBufs = [b]; return b; })() : (rxBufs[0] || Buffer.alloc(0));
        const hEnd = buf.indexOf(SEP);
        if (hEnd === -1) return;
        const headerStr = buf.slice(0, hEnd).toString('utf8');
        const cl = headerStr.match(/Content-Length:\s*(\d+)/i);
        const bodyLen = cl ? parseInt(cl[1]) : 0;
        const totalLen = hEnd + 4 + bodyLen;
        if (rxLen < totalLen) return;
        const body = buf.slice(hEnd + 4, totalLen);
        const rest = buf.slice(totalLen);
        rxBufs = rest.length ? [rest] : []; rxLen = rest.length;
        chain = chain.then(() => handle(headerStr, body)).catch(e => console.error('[Server] error:', e));
        if (rxLen > 0) parse(); // handle pipelining
      };

      const handle = async (headers: string, body: Buffer) => {
        const fl = headers.split('\r\n')[0];
        const [method, rawPath] = fl.split(' ');
        const qi = rawPath.indexOf('?');
        const path = qi >= 0 ? rawPath.slice(0, qi) : rawPath;
        const qs = qi >= 0 ? rawPath.slice(qi + 1) : '';
        const p: Record<string, string> = {};
        qs.split('&').forEach(s => { const e = s.indexOf('='); if (e > 0) p[decodeURIComponent(s.slice(0, e))] = decodeURIComponent(s.slice(e + 1).replace(/\+/g, ' ')); });

        // ── POST /api/upload ─────────────────────────────────────────────
        if (method === 'POST' && path === '/api/upload') {
          const fileName = p['name'] ?? '';
          const fileSize = parseInt(p['size'] ?? '0');
          const offset = parseInt(p['offset'] ?? '0');
          const isLast = p['last'] === '1';
          if (!fileName || !fileSize) { res(400, 'Bad Request'); return; }

          const tempPath = `${RNFS.CachesDirectoryPath}/up_${encodeURIComponent(fileName)}`;
          const finalPath = `${Platform.OS === 'android' ? RNFS.DownloadDirectoryPath : RNFS.DocumentDirectoryPath}/${fileName}`;

          if (offset === 0) {
            try { await RNFS.unlink(tempPath); } catch (_) { }
            await RNFS.writeFile(tempPath, '', 'utf8').catch(() => { });
            this.upload = { active: true, finalized: false, fileName, fileSize, received: 0, tempPath, finalPath, writeQueue: Promise.resolve(), tracker: new SpeedTracker() };
            this.upload.tracker.begin(0);
          }

          if (body.length > 0) {
            if (offset === 0) this.upload.received = 0;
            this.upload.received += body.length;
            const snap = { received: this.upload.received, data: body };
            // Enqueue disk write — TCP receive loop is NOT blocked by disk I/O
            this.upload.writeQueue = this.upload.writeQueue.then(async () => {
              await RNFS.appendFile(tempPath, snap.data.toString('base64'), 'base64');
              this.emitProgress(fileName, snap.received, fileSize, 'upload_progress', this.upload.tracker);
            }).catch(() => { });
          }

          res(200, 'OK');

          if ((isLast || this.upload.received >= fileSize) && !this.upload.finalized) {
            this.upload.finalized = true; this.upload.active = false;
            await this.upload.writeQueue; // ensure all chunks written before move
            try { await this.saveToDownloads(tempPath, finalPath, fileName); } catch (_) { }
            this.statusCallback?.({ type: 'upload_progress', fileProgress: { name: fileName, percent: 100, sent: fileSize, total: fileSize, speed: 0, etaSecs: 0 } });
            this.statusCallback?.({ type: 'complete', message: `Received ${fileName}` });
            saveHistoryItem({ fileName, fileSize, type: 'unknown', role: 'received', status: 'success' });
          }
          return;
        }

        // ── GET /api/files ─────────────────────────────────────────────────
        if (method === 'GET' && path === '/api/files') {
          resJSON(this.filesToSend.map(f => ({ name: f.name, size: f.size, type: f.type }))); return;
        }

        // ── GET /api/download ──────────────────────────────────────────────
        if (method === 'GET' && path === '/api/download') {
          const fileName = p['name'] ?? '';
          const file = this.filesToSend.find(f => f.name === fileName);
          if (!file) { res(404, 'Not Found'); return; }

          let fileSize = (file.rawSize ?? file.size ?? 0) as number;
          let readPath = file.uri as string;
          let isTmp = false;

          // Always stat the file to get the real byte count.
          // file.size from the metadata list can be stale or rounded.
          try {
            const realSize = (await RNFS.stat(readPath)).size;
            if (realSize > 0) fileSize = realSize;
          } catch (_) { }

          if (Platform.OS === 'android' && readPath.startsWith('content://')) {
            const tp = `${RNFS.CachesDirectoryPath}/dl_${Date.now()}_${file.name}`;
            try { await RNFS.copyFile(readPath, tp); readPath = tp; isTmp = true; } catch (_) { }
          }

          const rm = headers.match(/Range:\s*bytes=(\d+)-(\d+)?/i);
          let startByte = 0, endByte = fileSize - 1;
          const partial = !!rm && !this.secretKey;
          if (partial) { startByte = parseInt(rm[1]); if (rm[2]) endByte = parseInt(rm[2]); }

          const sendLen = endByte - startByte + 1;
          let hdrs = partial
            ? `HTTP/1.1 206 Partial Content\r\nContent-Range: bytes ${startByte}-${endByte}/${fileSize}\r\n`
            : `HTTP/1.1 200 OK\r\n`;
          hdrs += `Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="${fileName}"\r\nContent-Length: ${sendLen}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n`;

          if (socket.destroyed) return;
          try { socket.write(hdrs, 'utf8'); } catch (_) { socket.destroy(); return; }

          const tracker = new SpeedTracker();
          try {
            await this.pipeToSocket(socket, readPath, fileSize, startByte, endByte, fileName, tracker, !!this.secretKey);
          } finally {
            if (isTmp) RNFS.unlink(readPath).catch(() => { });
            if (!socket.destroyed) socket.end();
          }
          return;
        }

        // ── GET /api/register ──────────────────────────────────────────────
        if (method === 'GET' && path === '/api/register') {
          this.peerIp = socket.remoteAddress ?? null;
          this.peerServerPort = parseInt(p['port'] ?? '8888');
          if (this.peerRegisteredCb && this.peerIp) this.peerRegisteredCb(this.peerIp, this.peerServerPort);
          resText('OK'); return;
        }

        // ── GET / — web UI ─────────────────────────────────────────────────
        if (method === 'GET' && path === '/') {
          const html = this.getPage();
          const h = `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(html, 'utf8')}\r\nConnection: close\r\n\r\n${html}`;
          if (!socket.destroyed) try { socket.write(h, 'utf8', () => socket.end()); } catch (_) { socket.destroy(); }
          return;
        }

        res(404, 'Not Found');
      };

      const res = (code: number, msg: string) => {
        if (socket.destroyed) return;
        const body = code === 200 ? '' : msg;
        const h = `HTTP/1.1 ${code} ${msg}\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`;
        try { socket.write(h, 'utf8', () => { if (!socket.destroyed) socket.end(); }); } catch (_) { socket.destroy(); }
      };
      const resJSON = (data: any) => {
        if (socket.destroyed) return;
        const json = JSON.stringify(data);
        const h = `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: ${json.length}\r\nConnection: close\r\n\r\n${json}`;
        try { socket.write(h, 'utf8', () => socket.end()); } catch (_) { socket.destroy(); }
      };
      const resText = (text: string) => {
        if (socket.destroyed) return;
        const h = `HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: ${text.length}\r\nConnection: close\r\n\r\n${text}`;
        try { socket.write(h, 'utf8', () => socket.end()); } catch (_) { socket.destroy(); }
      };

      socket.on('error', () => { this.statusCallback?.({ type: 'error', message: 'Socket Error' }); });

    }).listen({ port, host: '0.0.0.0' }, () => { DiscoveryManager.publishService(port); });

    return { port };
  }

  // sendFile — Xender-style direct push (not HTTP pull)
  async sendFile(socket: any, fileName: string, startOffset = 0) {
    if (!socket || socket.destroyed) return;
    const file = this.filesToSend.find(f => f.name.trim().toLowerCase() === fileName.trim().toLowerCase());
    if (!file) return;
    try {
      let fileSize = (file.rawSize ?? file.size ?? 0) as number;
      if (!fileSize) try { fileSize = (await RNFS.stat(file.uri)).size; } catch (_) { }
      let readPath = file.uri as string;
      let isTmp = false;
      if (Platform.OS === 'android' && readPath.startsWith('content://')) {
        const tp = `${RNFS.CachesDirectoryPath}/send_${Date.now()}_${file.name}`;
        try { await RNFS.copyFile(readPath, tp); readPath = tp; isTmp = true; } catch (e) { throw e; }
      }
      const tracker = new SpeedTracker();
      try {
        await this.pipeToSocket(socket, readPath, fileSize, startOffset, fileSize - 1, file.name, tracker, !!this.secretKey);
        saveHistoryItem({ fileName: file.name, fileSize, type: file.type ?? 'unknown', role: 'sent', status: 'success' });
      } finally {
        if (isTmp) RNFS.unlink(readPath).catch(() => { });
      }
    } catch (e: any) {
      this.statusCallback?.({ type: 'error', message: e.message });
    }
  }

  updateFiles(newFiles: any[]) {
    newFiles.forEach(nf => { if (!this.filesToSend.find(f => f.name === nf.name && f.uri === nf.uri)) this.filesToSend.push(nf); });
  }

  stop() {
    if (this.server) { this.server.close(); this.server = null; }
    this.connectedClients.clear(); this.peerIp = null;
    DiscoveryManager.stopPublishing();
  }

  getPort() { return this.currentPort; }
  onPeerRegistered(cb?: (ip: string, port: number) => void) { this.peerRegisteredCb = cb; }
  getPeerInfo() { return { ip: this.peerIp, port: this.peerServerPort }; }
}

const TransferServerInstance = new TransferServer();
export const startServer = (port = 8888) => TransferServerInstance.start(port, []);
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