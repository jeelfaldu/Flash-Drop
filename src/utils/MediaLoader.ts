import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import RNFS from 'react-native-fs';

// Helper to process array in chunks to limit concurrency
const processInChunks = async <T, R>(
  items: T[],
  chunkSize: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(processor));
    results.push(...chunkResults);
  }
  return results;
};

export const getPhotosWithSizes = async (limit = 100) => {
  const photosData = await CameraRoll.getPhotos({
    first: limit,
    assetType: 'Photos',
    include: ['fileSize', 'filename', 'imageSize']
  });

  const photoProcessor = async (e: any) => {
    const uri = e.node.image.uri;
    let size = e.node.image.fileSize || 0;
    let filePath = e.node.image.filepath || uri;

    if (size === 0) {
      try {
        const stat = await RNFS.stat(uri);
        size = stat.size;
      } catch (err) {
        console.log('Could not stat photo:', uri, err);
      }
    }

    return {
      id: uri,
      uri: uri,
      type: 'image',
      folderPath: filePath,
      name: e.node.image.filename || `IMG_${Date.now()}.jpg`,
      size: size,
      timestamp: e.node.timestamp
    };
  };

  // Process in chunks of 10 to avoid too many concurrent RNFS.stat calls
  return processInChunks(photosData.edges, 10, photoProcessor);
};

export const getVideosWithSizes = async (limit = 50) => {
  const videoData = await CameraRoll.getPhotos({
    first: limit,
    assetType: 'Videos',
    include: ['fileSize', 'filename', 'playableDuration']
  });

  const videoProcessor = async (e: any) => {
    const uri = e.node.image.uri;
    let size = e.node.image.fileSize || 0;
    let filePath = e.node.image.filepath || uri;

    if (size === 0) {
      try {
        const stat = await RNFS.stat(uri);
        size = stat.size;
      } catch (err) {
        console.log('Could not stat video:', uri, err);
      }
    }

    return {
      id: uri,
      uri: uri,
      type: 'video',
      folderPath: filePath,
      name: e.node.image.filename || `VID_${Date.now()}.mp4`,
      size: size,
      duration: e.node.image.playableDuration,
      timestamp: e.node.timestamp
    };
  };

  // Process in chunks of 10
  return processInChunks(videoData.edges, 10, videoProcessor);
};
