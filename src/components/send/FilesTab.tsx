import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, Platform, BackHandler } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';

interface FilesTabProps {
  documents: any[];
  audio: any[];
  apps: any[];
  selectedItems: any[];
  fileCategory: 'audio' | 'docs' | 'apps' | 'browser';
  setFileCategory: (category: 'audio' | 'docs' | 'apps' | 'browser') => void;
  toggleSelection: (item: any) => void;
  pickDocument: () => void;
  formatSize: (bytes: number) => string;
  colors: any;
  typography: any;
  styles: any;
}

export const FilesTab: React.FC<FilesTabProps> = ({
  documents,
  audio,
  apps,
  selectedItems,
  fileCategory,
  setFileCategory,
  toggleSelection,
  pickDocument,
  formatSize,
  colors,
  typography,
  styles,
}) => {
  const [currentPath, setCurrentPath] = useState<string>(RNFS.ExternalStorageDirectoryPath || '');
  const [browserItems, setBrowserItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadDirectory = useCallback(async (path: string) => {
    if (!path) return;
    setIsLoading(true);
    try {
      const result = await RNFS.readDir(path);
      const items = result.map(item => ({
        id: item.path,
        uri: `file://${item.path}`,
        name: item.name,
        size: item.size,
        type: item.isDirectory() ? 'directory' : 'document',
        path: item.path,
        mime: item.name.split('.').pop()?.toLowerCase() || ''
      })).sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
      setBrowserItems(items);
      setCurrentPath(path);
    } catch (e) {
      console.log('Error reading directory:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fileCategory === 'browser') {
      loadDirectory(currentPath);
    }
  }, [fileCategory, currentPath, loadDirectory]);

  // Handle back button for browser navigation
  useEffect(() => {
    const backAction = () => {
      if (fileCategory === 'browser' && currentPath !== RNFS.ExternalStorageDirectoryPath) {
        const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
        loadDirectory(parentPath || RNFS.ExternalStorageDirectoryPath);
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [fileCategory, currentPath, loadDirectory]);

  const getFilteredData = () => {
    switch (fileCategory) {
      case 'audio': return audio;
      case 'docs': return documents;
      case 'apps': return apps;
      case 'browser': return browserItems;
      default: return [...apps, ...audio, ...documents].sort((a, b) => a.name.localeCompare(b.name));
    }
  };

  const renderFileItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    const isDirectory = item.type === 'directory';

    const getIcon = () => {
      if (isDirectory) return 'folder';
      if (item.type === 'app') return 'android';
      if (item.type === 'audio') return 'music-note';
      if (item.mime === 'pdf') return 'file-pdf-box';
      if (['doc', 'docx'].includes(item.mime)) return 'file-word-outline';
      if (['xls', 'xlsx'].includes(item.mime)) return 'file-excel-outline';
      return 'file-document-outline';
    };

    const getIconColor = () => {
      if (isDirectory) return '#FFA000';
      if (item.type === 'app') return '#4CAF50';
      if (item.type === 'audio') return '#E91E63';
      if (item.mime === 'pdf') return '#F44336';
      return colors.primary;
    };

    const handlePress = () => {
      if (isDirectory) {
        loadDirectory(item.path);
      } else {
        toggleSelection(item);
      }
    };

    return (
      <TouchableOpacity 
        onPress={handlePress} 
        style={[
          styles.listItem,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border
          }
        ]}
      >
        <View style={[styles.listIconBox, { backgroundColor: `${getIconColor()}15` }]}>
          <Icon
            name={getIcon()}
            size={28}
            color={getIconColor()}
          />
        </View>
        <View style={styles.listDetails}>
          <Text style={[styles.listName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.listSize, { color: colors.subtext, fontFamily: typography.fontFamily }]}>
            {isDirectory ? 'Folder' : formatSize(item.size)}
          </Text>
        </View>
        {!isDirectory && (
          <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
            {isSelected && <Icon name="check" size={14} color="#FFF" />}
          </View>
        )}
        {isDirectory && <Icon name="chevron-right" size={20} color={colors.border} />}
      </TouchableOpacity>
    );
  };

  const renderBreadcrumbs = () => {
    if (fileCategory !== 'browser') return null;
    const parts = currentPath.split('/').filter(Boolean);
    const relativeParts = parts.slice(parts.indexOf('0') + 1); // Get parts after Internal Storage root (usually /storage/emulated/0)

    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, flexWrap: 'wrap' }}>
        <TouchableOpacity onPress={() => loadDirectory(RNFS.ExternalStorageDirectoryPath)}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>Root</Text>
        </TouchableOpacity>
        {relativeParts.map((part, index) => (
          <React.Fragment key={index}>
            <Icon name="chevron-right" size={16} color={colors.subtext} />
            <TouchableOpacity
              onPress={() => {
                const targetPath = '/' + parts.slice(0, parts.indexOf(part) + 1).join('/');
                loadDirectory(targetPath);
              }}
            >
              <Text style={{ color: colors.primary, fontWeight: index === relativeParts.length - 1 ? '700' : '400' }} numberOfLines={1}>
                {part}
              </Text>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.categoryFilterRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[
            { id: 'browser', label: 'Browser', icon: 'folder-search' },
            { id: 'docs', label: 'Docs', icon: 'file-document' },
            { id: 'audio', label: 'Music', icon: 'music' },
            { id: 'apps', label: 'Apps', icon: 'android' },
          ]}
          renderItem={({ item: cat }) => (
            <TouchableOpacity
              onPress={() => setFileCategory(cat.id as any)}
              style={[
                styles.categoryBtn,
                fileCategory === cat.id && { backgroundColor: colors.primary }
              ]}
            >
              <Icon name={cat.icon} size={16} color={fileCategory === cat.id ? '#FFF' : colors.subtext} />
              <Text style={[
                styles.categoryBtnText,
                { color: fileCategory === cat.id ? '#FFF' : colors.subtext }
              ]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          )}
          keyExtractor={item => item.id}
        />
      </View>

      {renderBreadcrumbs()}

      {fileCategory !== 'browser' && (
        <TouchableOpacity style={styles.pickDocBtn} onPress={pickDocument}>
          <Icon name="folder-plus" size={24} color={colors.primary} />
          <Text style={[styles.pickDocText, { color: colors.primary, fontFamily: typography.fontFamily }]}>Choose from Explorer</Text>
        </TouchableOpacity>
      )}

      <FlatList
        key={fileCategory}
        data={getFilteredData()}
        renderItem={renderFileItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name={isLoading ? "loading" : "file-search-outline"} size={64} color={colors.border} />
            <Text style={[styles.emptyText, { color: colors.subtext }]}>
              {isLoading ? "Loading..." : "No files found"}
            </Text>
          </View>
        }
      />
    </View>
  );
};
