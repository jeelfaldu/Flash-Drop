
import { getPhotosWithSizes } from '../src/utils/MediaLoader';
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import RNFS from 'react-native-fs';

// Mock the modules
jest.mock('@react-native-camera-roll/camera-roll', () => ({
  CameraRoll: {
    getPhotos: jest.fn()
  }
}));

jest.mock('react-native-fs', () => ({
  stat: jest.fn()
}));

describe('MediaLoader Performance', () => {
  let activeStats = 0;
  let maxConcurrentStats = 0;

  beforeEach(() => {
    activeStats = 0;
    maxConcurrentStats = 0;
    jest.clearAllMocks();

    // Mock CameraRoll to return 100 items with fileSize 0 (forcing stat call)
    (CameraRoll.getPhotos as jest.Mock).mockResolvedValue({
      edges: Array(100).fill(0).map((_, i) => ({
        node: {
          image: {
            uri: `file://${i}`,
            fileSize: 0,
            filename: `img_${i}.jpg`
          },
          timestamp: 1234567890
        }
      }))
    });

    // Mock RNFS.stat with a delay and concurrency tracking
    (RNFS.stat as jest.Mock).mockImplementation(async () => {
      activeStats++;
      if (activeStats > maxConcurrentStats) {
        maxConcurrentStats = activeStats;
      }

      // Simulate I/O delay
      await new Promise(resolve => setTimeout(resolve, 10));

      activeStats--;
      return { size: 1024 };
    });
  });

  it('should limit concurrent RNFS.stat calls', async () => {
    // Process 100 items
    const photos = await getPhotosWithSizes(100);

    console.log(`Max concurrent RNFS.stat calls: ${maxConcurrentStats}`);

    // Expectation for the optimized version:
    // With chunk size 10, max concurrency should be <= 10
    expect(maxConcurrentStats).toBeLessThanOrEqual(10);
    expect(maxConcurrentStats).toBeGreaterThan(0);

    // Verify all items were processed
    expect(photos.length).toBe(100);
    expect(RNFS.stat).toHaveBeenCalledTimes(100);
  });
});
