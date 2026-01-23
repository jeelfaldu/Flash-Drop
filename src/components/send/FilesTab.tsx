import React from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface FilesTabProps {
  documents: any[];
  audio: any[];
  apps: any[];
  selectedItems: any[];
  fileCategory: 'all' | 'audio' | 'docs' | 'apps';
  setFileCategory: (category: 'all' | 'audio' | 'docs' | 'apps') => void;
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
  const getFilteredData = () => {
    switch (fileCategory) {
      case 'audio': return audio;
      case 'docs': return documents;
      case 'apps': return apps;
      default: return [...apps, ...audio, ...documents].sort((a, b) => a.name.localeCompare(b.name));
    }
  };

  const renderFileItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    const getIcon = () => {
      if (item.type === 'app') return 'android';
      if (item.type === 'audio') return 'music-note';
      if (item.mime === 'pdf') return 'file-pdf-box';
      if (['doc', 'docx'].includes(item.mime)) return 'file-word-outline';
      if (['xls', 'xlsx'].includes(item.mime)) return 'file-excel-outline';
      return 'file-document-outline';
    };

    const getIconColor = () => {
      if (item.type === 'app') return '#4CAF50';
      if (item.type === 'audio') return '#E91E63';
      if (item.mime === 'pdf') return '#F44336';
      return colors.primary;
    };

    return (
      <TouchableOpacity 
        onPress={() => toggleSelection(item)} 
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
            name={item.icon || getIcon()}
            size={28}
            color={getIconColor()}
          />
        </View>
        <View style={styles.listDetails}>
          <Text style={[styles.listName, { color: colors.text, fontFamily: typography.fontFamily }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.listSize, { color: colors.subtext, fontFamily: typography.fontFamily }]}>{formatSize(item.size)}</Text>
        </View>
        <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          {isSelected && <Icon name="check" size={14} color="#FFF" />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.categoryFilterRow}>
        {[
          { id: 'all', label: 'All', icon: 'file-multiple' },
          { id: 'docs', label: 'Docs', icon: 'file-document' },
          { id: 'audio', label: 'Music', icon: 'music' },
          { id: 'apps', label: 'Apps', icon: 'android' },
        ].map(cat => (
          <TouchableOpacity
            key={cat.id}
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
        ))}
      </View>

      <TouchableOpacity style={styles.pickDocBtn} onPress={pickDocument}>
        <Icon name="folder-plus" size={24} color={colors.primary} />
        <Text style={[styles.pickDocText, { color: colors.primary, fontFamily: typography.fontFamily }]}>Choose from Explorer</Text>
      </TouchableOpacity>

      <FlatList
        key="files"
        data={getFilteredData()}
        renderItem={renderFileItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="file-search-outline" size={64} color={colors.border} />
            <Text style={[styles.emptyText, { color: colors.subtext }]}>No files found</Text>
          </View>
        }
      />
    </View>
  );
};
