import { useEffect } from 'react';
import { Platform } from 'react-native';
import ReceiveSharingIntent from 'react-native-receive-sharing-intent';
import { useTransferStore, FileItem, useConnectionStore } from '../store';
import TransferServer from '../utils/TransferServer';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import { navigationRef } from '../../App';

export const useSharingIntent = () => {
  const setSelectedItems = useTransferStore((state) => state.setSelectedItems);

  useEffect(() => {
    if (Platform.OS === 'ios') return; // Library handles iOS differently via Share Extension

    const handleInitialFiles = () => {
      // Add a substantial delay to ensure Native side is fully ready
      setTimeout(() => {
        try {
          ReceiveSharingIntent.getReceivedFiles(
            (files: any) => {
              handleFiles(files);
            },
            (error: any) => {
              // NPE on getAction() is a known issue if no share intent is present
              if (!error?.toString().includes('null object reference')) {
                console.log('ReceiveSharingIntent Error:', error);
              }
            },
            'ShareKey'
          );
        } catch (e) {
          console.log('ReceiveSharingIntent Exception:', e);
        }
      }, 1500);
    };

    handleInitialFiles();

    return () => {
      try { ReceiveSharingIntent.clearReceivedFiles(); } catch (e) { }
    };
  }, []);

  const handleFiles = async (files: any[]) => {
    if (!files || files.length === 0) return;

    console.log('Received shared files:', files);

    const mappedFiles: FileItem[] = await Promise.all(
      files.map(async (file, index) => {
        const path = file.filePath || file.contentUri || file.weblink || '';
        const name = file.fileName || (path && path.split('/').pop()) || `Shared_${index}`;
        
        let size = 0;
        let type = file.mimeType || 'application/octet-stream';

        if (file.weblink || (path && path.startsWith('http'))) {
          type = 'text/url';
          size = Buffer.byteLength(path, 'utf8');
        } else if (path) {
          try {
            const stats = await RNFS.stat(path);
            size = Number(stats.size);
          } catch (e) {
            console.warn('Could not get file size for shared file:', e);
            size = 0;
          }
        } else if (file.text) {
          type = 'text/plain';
          size = Buffer.byteLength(file.text, 'utf8');
        }

        return {
          id: (path || file.text || 'item') + '_' + Date.now() + '_' + index,
          name: name,
          size: size,
          uri: path || '',
          text: file.text || '',
          type: type,
          status: 'pending' as const,
        };
      })
    );

    if (mappedFiles.length > 0) {
      const isConnected = useConnectionStore.getState().isConnected;
      
      // If we are already connected, we don't want to overwrite the whole selection 
      // but just add these files to the transfer.
      // However, for the initial share, setting selectedItems is fine.
      setSelectedItems(mappedFiles);
      
      if (navigationRef.isReady()) {
         setTimeout(() => {
            if (isConnected) {
              // Replicate SendScreen logic for connected state
              TransferServer.updateFiles(mappedFiles);
              (navigationRef as any).navigate('FileTransfer', {
                role: 'sender',
                initialFiles: mappedFiles,
                deviceName: 'Connected Device'
              });
            } else {
              // Replicate SendScreen logic for non-connected state
              (navigationRef as any).navigate('Sharing', { 
                items: mappedFiles 
              });
            }
            
            // Clear selection after a delay, same as SendScreen
            setTimeout(() => {
              useTransferStore.getState().clearSelection();
            }, 1000);
         }, 500);
      }
    }
  };
};
