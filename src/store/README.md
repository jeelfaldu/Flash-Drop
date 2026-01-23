# Zustand State Management

FlashDrop uses Zustand for global state management.

## Stores

### 1. Transfer Store (`useTransferStore`)
Manages the file transfer process and selected items.

**State:**
- `role`: 'sender' | 'receiver' | null - Current transfer role
- `deviceName`: string - Connected device name
- `isTransferring`: boolean - Transfer status
- `selectedItems`: any[] - Items selected for transfer

**Actions:**
- `setSelectedItems(items)` - Set selected items
- `toggleItem(item)` - Toggle item selection
- `clearSelection()` - Clear all selections
- `setRole(role, deviceName)` - Set transfer role
- `setTransferring(status)` - Set transferring status
- `resetTransfer()` - Reset all transfer state

### 2. Connection Store (`useConnectionStore`)
Manages network connection state.

**State:**
- `isConnected`: boolean
- `connectionType`: 'wifi-direct' | 'hotspot' | null
- `ipAddress`: string
- `ssid`: string

**Actions:**
- `setConnected(connected)` - Set connection status
- `setConnectionDetails(details)` - Set connection info
- `resetConnection()` - Reset connection state

### 3. Media Store (`useMediaStore`)
Manages media and file data loaded from device.

**State:**
- `photos`: any[]
- `videos`: any[]
- `documents`: any[]
- `contacts`: any[]
- `apps`: any[]

**Actions:**
- `setPhotos(photos)` - Set photos array
- `setVideos(videos)` - Set videos array
- `setDocuments(documents)` - Set documents array
- `setContacts(contacts)` - Set contacts array
- `setApps(apps)` - Set apps array
- `addDocuments(newDocs)` - Add new documents
- `clearAll()` - Clear all media

## Usage Example

```tsx
import { useTransferStore, useMediaStore } from '../store';

function SendScreen() {
  const { selectedItems, toggleItem } = useTransferStore();
  const { photos, setPhotos } = useMediaStore();
  
  // Use the store
  const handleSelect = (item) => {
    toggleItem(item);
  };
  
  return (
    // ... component
  );
}
```

## Benefits

1. **Centralized State**: All global state in one place
2. **Performance**: Only re-renders components that use changed state
3. **DevTools Support**: Zustand DevTools for debugging
4. **TypeScript**: Full type safety
5. **Simple API**: Easy to use and understand
