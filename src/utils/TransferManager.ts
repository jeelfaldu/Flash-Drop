import { useTransferStore, FileItem, TransferStats } from '../store';
import TransferServer, { ServerStatus } from './TransferServer';
import TransferClient, { TransferStatus } from './TransferClient';
import WiFiDirectTransferService, { DirectTransferStatus } from './Wifidirecttransferservice';
import NotificationService from './NotificationService';
import HapticUtil from './HapticUtil';

class TransferManager {
  private static instance: TransferManager;
  private initialized = false;

  private constructor() {}

  public static getInstance(): TransferManager {
    if (!TransferManager.instance) {
      TransferManager.instance = new TransferManager();
    }
    return TransferManager.instance;
  }

  public initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Hook into global services using the new multi-listener system
    TransferServer.addStatusListener((status) => this.handleServerStatus(status));
    TransferClient.addStatusListener((status) => this.handleClientStatus(status));
    
    // Wi-Fi Direct service often acts as a bridge, we need its P2P status too
    const originalWDStatus = WiFiDirectTransferService.onStatus;
    WiFiDirectTransferService.onStatus = (status: DirectTransferStatus) => {
      if (status.type === 'server') this.handleServerStatus(status.status);
      else if (status.type === 'client') this.handleClientStatus(status.status);
      originalWDStatus?.(status);
    };
  }

  private handleServerStatus(status: ServerStatus) {
    if (status.context !== 'p2p') return; // 🛑 Ignore PC transfers
    if (status.type === 'progress' || status.type === 'upload_progress' || status.type === 'complete') {
      const fp = status.fileProgress;
      if (fp) this.updateFileProgress(fp.name, fp.percent, fp.sent, fp.total, fp.speed, fp.etaSecs);
    }
  }

  private handleClientStatus(status: TransferStatus) {
    if (status.context !== 'p2p') return; // 🛑 Ignore PC transfers
    if ((status.type === 'progress' || status.type === 'complete') && status.fileProgress) {
      const fp = status.fileProgress;
      this.updateFileProgress(fp.name, fp.percent, fp.received, fp.total, fp.speed, fp.etaSecs);
    }

    if (status.files) {
      const { setFiles, setTransferStats } = useTransferStore.getState();
      setFiles((prev) => {
        const updated = { ...prev };
        let added = false;
        (status.files as any[]).forEach((f: any) => {
          if (!updated[f.name]) {
            updated[f.name] = {
              id: f.name,
              uri: '',
              name: f.name,
              size: f.size || 0,
              progress: 0,
              status: 'pending' as const,
              type: f.type,
              direction: 'received'
            };
            added = true;
          }
        });
        if (added) {
          const allFiles = Object.values(updated) as FileItem[];
          const grandTotal = allFiles.reduce((acc: number, f: FileItem) => acc + (f.size || 0), 0);
          setTransferStats({ totalSize: grandTotal });
        }
        return updated;
      });
    }
  }

  private formatSize(bytes: number) {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private updateFileProgress(
    name: string,
    percent: number,
    currentSize: number,
    fileTotal?: number,
    speedBps?: number,
    etaSecs?: number
  ) {
    const { setFiles, setTransferStats, role } = useTransferStore.getState();

    setFiles((prev) => {
      const updated = { ...prev };
      if (updated[name]) {
        updated[name] = {
          ...updated[name],
          size: (updated[name].size || 0) > 0 ? updated[name].size : (fileTotal || 0),
          progress: percent / 100,
          status: percent === 100 ? ('completed' as const) : (role === 'sender' ? 'uploading' as const : 'downloading' as const)
        };
      } else {
        updated[name] = {
          id: name,
          uri: '',
          name,
          size: fileTotal || 0,
          progress: percent / 100,
          type: 'file',
          direction: role === 'sender' ? 'sent' : 'received',
          status: role === 'sender' ? ('uploading' as const) : ('downloading' as const)
        };
      }

      // Calculate overall stats
      const allFiles = Object.values(updated) as FileItem[];
      const totalTransferred = allFiles.reduce((acc: number, f: FileItem) =>
        acc + ((f.size || 0) * (typeof f.progress === 'number' ? f.progress : 0)), 0);
      const totalSize = allFiles.reduce((acc: number, f: FileItem) => acc + (f.size || 0), 0);
      const progress = totalSize > 0 ? totalTransferred / totalSize : 0;

      setTransferStats((prevStat: TransferStats) => {
        const now = Date.now();
        let speed = prevStat.transferSpeed || '0 KB/s';
        let eta = prevStat.eta || '--:--';

        if (speedBps !== undefined && speedBps > 0) {
          speed = speedBps > 1024 * 1024
            ? (speedBps / (1024 * 1024)).toFixed(2) + ' MB/s'
            : (speedBps / 1024).toFixed(2) + ' KB/s';

          if (etaSecs !== undefined && etaSecs > 0 && etaSecs < 86400) {
            if (etaSecs < 3600) {
              const mins = Math.floor(etaSecs / 60);
              const secs = Math.floor(etaSecs % 60);
              eta = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
            } else {
              eta = '> 1h';
            }
          } else if (percent >= 100) {
            eta = '0:00';
          }
        }

        // Only update notifications/haptics every 1.5s or on completion
        if (now - prevStat.lastUpdateTime > 1500 || progress >= 1) {
          if (progress >= 1 && prevStat.overallProgress < 1) {
            NotificationService.displayCompleteNotification(name, true);
            HapticUtil.celebrate();
          } else if (progress < 1) {
            if (percent === 100) HapticUtil.success();
            NotificationService.displayTransferNotification(name, progress, role === 'sender');
          }
        }

        return {
          transferredSize: totalTransferred,
          totalSize,
          overallProgress: progress,
          leftData: this.formatSize(Math.max(0, totalSize - totalTransferred)),
          transferSpeed: speed,
          eta,
          lastUpdateTime: now,
          lastTransferredSize: totalTransferred,
        };
      });

      return updated;
    });
  }
}

export default TransferManager.getInstance();
