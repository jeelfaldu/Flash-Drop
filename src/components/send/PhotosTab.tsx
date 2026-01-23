import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, FlatList, Dimensions } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width } = Dimensions.get('window');

interface PhotosTabProps {
  photos: any[];
  selectedItems: any[];
  toggleSelection: (item: any) => void;
  toggleDateSelection: (datePhotos: any[]) => void;
  colors: any;
  typography: any;
  styles: any;
}

export const PhotosTab: React.FC<PhotosTabProps> = ({
  photos,
  selectedItems,
  toggleSelection,
  toggleDateSelection,
  colors,
  typography,
  styles,
}) => {
  const grouped = photos.reduce((acc: any, photo) => {
    const date = photo.timestamp ? new Date(photo.timestamp * 1000).toISOString().split('T')[0] : 'Other';
    if (!acc[date]) acc[date] = [];
    acc[date].push(photo);
    return acc;
  }, {});

  const sections = Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map(date => ({
    title: date,
    data: grouped[date]
  }));

  const renderPhotoItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    return (
      <TouchableOpacity onPress={() => toggleSelection(item)} style={styles.gridItem}>
        <Image source={{ uri: item.uri }} style={styles.gridImage} />
        <View style={styles.selectionOverlay}>
          <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
            {isSelected && <Icon name="check" size={14} color="#FFF" />}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <FlatList
      data={sections}
      keyExtractor={item => item.title}
      contentContainerStyle={styles.gridContent}
      renderItem={({ item: section }) => {
        const isAllSelected = section.data.every((p: any) => selectedItems.find(i => i.id === p.id));
        return (
          <View style={styles.dateSection}>
            <View style={[styles.dateHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.dateTitle, { color: colors.text, fontFamily: typography.fontFamily }]}>{section.title}</Text>
              <TouchableOpacity onPress={() => toggleDateSelection(section.data)} style={styles.headerCheckbox}>
                <View style={[styles.checkbox, isAllSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                  {isAllSelected && <Icon name="check" size={14} color="#FFF" />}
                </View>
              </TouchableOpacity>
            </View>
            <FlatList
              data={section.data}
              numColumns={3}
              renderItem={renderPhotoItem}
              keyExtractor={p => p.id}
              scrollEnabled={false}
            />
          </View>
        );
      }}
    />
  );
};
