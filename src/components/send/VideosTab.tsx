import React from 'react';
import { View, Text, TouchableOpacity, Image, FlatList } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

const adUnitId = __DEV__ ? TestIds.ADAPTIVE_BANNER : 'ca-app-pub-3940256099942544/6300978111';

interface VideosTabProps {
  videos: any[];
  selectedItems: any[];
  toggleSelection: (item: any) => void;
  toggleDateSelection: (dateItems: any[]) => void;
  formatSize: (bytes: number) => string;
  colors: any;
  typography: any;
  styles: any;
  onPreview: (item: any) => void;
}

export const VideosTab: React.FC<VideosTabProps> = ({
  videos,
  selectedItems,
  toggleSelection,
  toggleDateSelection,
  formatSize,
  colors,
  typography,
  styles,
  onPreview,
}) => {
  const grouped = videos.reduce((acc: any, video) => {
    const date = video.timestamp ? new Date(video.timestamp * 1000).toISOString().split('T')[0] : 'Other';
    if (!acc[date]) acc[date] = [];
    acc[date].push(video);
    return acc;
  }, {});

  const sections = Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map(date => ({
    title: date,
    data: grouped[date]
  }));

  const renderVideoItem = ({ item }: { item: any }) => {
    const isSelected = selectedItems.find(i => i.id === item.id);
    return (
      <TouchableOpacity 
        onPress={() => toggleSelection(item)} 
        onLongPress={() => onPreview(item)}
        style={[styles.videoListItem, { borderBottomColor: colors.border }]}
      >
        <View style={styles.videoThumbContainer}>
          <Image source={{ uri: item.uri }} style={styles.videoThumb} />
          <View style={styles.videoDurationBadge}>
            <Text style={styles.videoDurationText}>
              {Math.floor(item.duration / 60)}:{Math.floor(item.duration % 60).toString().padStart(2, '0')}
            </Text>
          </View>
        </View>
        <View style={styles.videoInfo}>
          <Text style={[styles.videoName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.videoSize, { color: colors.subtext }]}>{formatSize(item.size)}</Text>
        </View>
        <View style={[styles.checkbox, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          {isSelected && <Icon name="check" size={14} color="#FFF" />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <FlatList
      data={sections}
      keyExtractor={item => item.title}
      contentContainerStyle={styles.listContent}
      renderItem={({ item: section, index }) => {
        const isAllSelected = section.data.every((v: any) => selectedItems.find(i => i.id === v.id));
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
            {section.data.map((video: any) => (
              <React.Fragment key={video.id}>
                {renderVideoItem({ item: video })}
              </React.Fragment>
            ))}
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
      }}
    />
  );
};
