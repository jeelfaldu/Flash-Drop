import RNFS from 'react-native-fs';

/**
 * Processes an array of items in chunks to limit concurrent asynchronous operations.
 *
 * @param items The array of items to process.
 * @param chunkSize The number of items to process concurrently in each chunk.
 * @param processor A function that processes a single item and returns a promise.
 * @returns A promise that resolves to an array of results.
 */
export async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(processor));
    results.push(...chunkResults);
  }
  return results;
}

/**
 * Loads sizes for CameraRoll assets (photos or videos) in chunks.
 *
 * @param edges The CameraRoll asset edges.
 * @param type The type of asset ('image' or 'video').
 * @returns A promise that resolves to an array of assets with sizes.
 */
export const loadAssetSizes = async (edges: any[], type: 'image' | 'video') => {
  const CHUNK_SIZE = 10;

  return processInChunks(edges, CHUNK_SIZE, async (e) => {
    const uri = e.node.image.uri;
    let size = e.node.image.fileSize || 0;
    let filePath = e.node.image.filepath || uri;

    if (size === 0) {
      try {
        const stat = await RNFS.stat(uri);
        size = stat.size;
      } catch (err) {
        console.log(`[MediaLoader] Could not stat ${type}:`, uri, err);
      }
    }

    const item: any = {
      id: uri,
      uri: uri,
      type: type,
      folderPath: filePath,
      name: e.node.image.filename || `${type === 'image' ? 'IMG' : 'VID'}_${Date.now()}.${type === 'image' ? 'jpg' : 'mp4'}`,
      size: size,
      timestamp: e.node.timestamp
    };

    if (type === 'video') {
      item.duration = e.node.image.playableDuration;
    }

    return item;
  });
};
