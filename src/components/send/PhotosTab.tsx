import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, FlatList, Dimensions, PanResponder } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

const adUnitId = __DEV__ ? TestIds.ADAPTIVE_BANNER : 'ca-app-pub-3940256099942544/6300978111';

const { width } = Dimensions.get('window');

interface PhotosTabProps {
  photos: any[];
  selectedItems: any[];
  toggleSelection: (item: any) => void;
  toggleDateSelection: (datePhotos: any[]) => void;
  colors: any;
  typography: any;
  styles: any;
  onPreview: (item: any) => void;
}

// Optimized Photo Item with memoization
const PhotoItem = memo(({ item, isSelected, onPress, onLongPress, onLayout, colors, styles }: any) => {
  return (
    <View
      style={styles.gridItem}
      onLayout={(e) => {
        // Measure only once or when layout changes
        e.target.measureInWindow((x: number, y: number, w: number, h: number) => {
          onLayout(item.id, { x, y, w, h });
        });
      }}
    >
      <TouchableOpacity
        onPress={() => onPress(item)}
        onLongPress={() => onLongPress(item)}
        delayLongPress={300}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: item.uri }}
          style={styles.gridImage}
          fadeDuration={0} // Performance boost
        />
        <View style={styles.selectionOverlay}>
          <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
            {isSelected && <Icon name="check" size={14} color="#FFF" />}
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}, (prev, next) => prev.isSelected === next.isSelected);

export const PhotosTab: React.FC<PhotosTabProps> = ({
  photos,
  selectedItems,
  toggleSelection,
  toggleDateSelection,
  colors,
  typography,
  styles,
  onPreview,
}) => {
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const itemLayouts = useRef<Record<string, { x: number, y: number, w: number, h: number }>>({});
  const lastSelectedIndex = useRef<string | null>(null);

  // Memoize grouped data
  const grouped = useMemo(() => photos.reduce((acc: any, photo) => {
    const date = photo.timestamp ? new Date(photo.timestamp * 1000).toISOString().split('T')[0] : 'Other';
    if (!acc[date]) acc[date] = [];
    acc[date].push(photo);
    return acc;
  }, {}), [photos]);

  const sections = useMemo(() => Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map(date => ({
    title: date,
    data: grouped[date]
  })), [grouped]);

  const handleSelection = useCallback((item: any) => {
    toggleSelection(item);
  }, [toggleSelection]);

  const handlePreview = useCallback((item: any) => {
    onPreview(item);
  }, [onPreview]);

  const handleLayout = useCallback((id: string, layout: any) => {
    itemLayouts.current[id] = layout;
  }, []);

  const handleDrag = useCallback((evt: any) => {
    const { pageX, pageY } = evt.nativeEvent;

    // Quick escape if touch is outside known grid items (optimized search)
    const entries = Object.entries(itemLayouts.current);
    for (let i = entries.length - 1; i >= 0; i--) {
      const [id, layout] = entries[i];
      if (
        pageY >= layout.y && pageY <= layout.y + layout.h &&
        pageX >= layout.x && pageX <= layout.x + layout.w
      ) {
        if (lastSelectedIndex.current !== id) {
          const item = photos.find(p => p.id === id);
          if (item) {
            handleSelection(item);
            lastSelectedIndex.current = id;
          }
        }
        break;
      }
    }
  }, [photos, handleSelection]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 30 || Math.abs(gesture.dy) > 30,
    onPanResponderGrant: () => {
      setIsDragSelecting(true);
      lastSelectedIndex.current = null;
    },
    onPanResponderMove: (evt) => handleDrag(evt),
    onPanResponderRelease: () => {
      setIsDragSelecting(false);
      lastSelectedIndex.current = null;
    },
    onPanResponderTerminate: () => {
      setIsDragSelecting(false);
    }
  }), [handleDrag]);

  const renderPhotoItem = useCallback(({ item }: any) => {
    const isSelected = !!selectedItems.find(i => i.id === item.id);
    return (
      <PhotoItem
        item={item}
        isSelected={isSelected}
        onPress={handleSelection}
        onLongPress={handlePreview}
        onLayout={handleLayout}
        colors={colors}
        styles={styles}
      />
    );
  }, [selectedItems, handleSelection, handlePreview, handleLayout, colors, styles]);

  const renderSection = useCallback(({ item: section, index }: any) => {
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
          numColumns={4}
          renderItem={renderPhotoItem}
          keyExtractor={p => p.id}
          scrollEnabled={false}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          removeClippedSubviews={true}
        />
        {index % 3 === 2 && (
          <View style={{ alignItems: 'center', marginVertical: 15 }}>
            <BannerAd
              unitId={adUnitId}
              size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
              requestOptions={{
                requestNonPersonalizedAdsOnly: false,
              }}
            />
          </View>
        )}
      </View>
    );
  }, [selectedItems, renderPhotoItem, toggleDateSelection, colors, typography, styles]);

  return (
    <View style={{ flex: 1 }} {...panResponder.panHandlers}>
      <FlatList
        data={sections}
        keyExtractor={item => item.title}
        scrollEnabled={!isDragSelecting}
        contentContainerStyle={styles.gridContent}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={10}
        removeClippedSubviews={true}
        renderItem={renderSection}
      />
    </View>
  );
};
