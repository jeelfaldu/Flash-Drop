import { processInChunks } from '../MediaLoader';

// Mock RNFS
jest.mock('react-native-fs', () => ({
  stat: jest.fn(),
}));

describe('MediaLoader', () => {
  describe('processInChunks', () => {
    it('should process items and return correct results', async () => {
      const items = [1, 2, 3, 4, 5];
      const chunkSize = 2;
      const processor = async (item: number) => item * 2;

      const results = await processInChunks(items, chunkSize, processor);

      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it('should handle empty array', async () => {
      const items: number[] = [];
      const chunkSize = 2;
      const processor = async (item: number) => item * 2;

      const results = await processInChunks(items, chunkSize, processor);

      expect(results).toEqual([]);
    });

    it('should handle chunk size larger than array length', async () => {
      const items = [1, 2];
      const chunkSize = 5;
      const processor = async (item: number) => item * 2;

      const results = await processInChunks(items, chunkSize, processor);

      expect(results).toEqual([2, 4]);
    });

    it('should process in order of chunks', async () => {
      const items = [1, 2, 3, 4];
      const chunkSize = 2;
      const executionOrder: number[] = [];

      const processor = async (item: number) => {
        executionOrder.push(item);
        return item;
      };

      await processInChunks(items, chunkSize, processor);

      // Since it uses Promise.all(chunk.map(processor)),
      // elements within a chunk might finish in any order,
      // but chunks themselves are processed sequentially.
      // 1 and 2 are in chunk 1, 3 and 4 are in chunk 2.
      expect(executionOrder.slice(0, 2)).toContain(1);
      expect(executionOrder.slice(0, 2)).toContain(2);
      expect(executionOrder.slice(2, 4)).toContain(3);
      expect(executionOrder.slice(2, 4)).toContain(4);
    });
  });
});
