
import TransferClient from '../src/utils/TransferClient';
import TcpSocket from 'react-native-tcp-socket';

// Mocks
jest.mock('react-native-tcp-socket', () => ({
    createConnection: jest.fn(),
}));

jest.mock('react-native-fs', () => ({
    exists: jest.fn(() => Promise.resolve(true)),
    mkdir: jest.fn(() => Promise.resolve()),
    unlink: jest.fn(() => Promise.resolve()),
    appendFile: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native-device-info', () => ({
    getIpAddress: jest.fn(() => Promise.resolve('192.168.1.5')),
}));

jest.mock('react-native-wifi-reborn', () => ({
    forceWifiUsage: jest.fn(),
    getDhcpInfo: jest.fn(() => Promise.resolve({ gateway: '192.168.1.1' })),
}));

jest.mock('../src/utils/HistoryService', () => ({
    saveHistoryItem: jest.fn(),
}));

describe('TransferClient Performance', () => {
    let createConnectionMock: any;
    const originalSetTimeout = global.setTimeout;
    let scanCompletePromise: Promise<void>;
    let scanCompleteResolve: () => void;

    beforeEach(() => {
        jest.clearAllMocks();
        createConnectionMock = TcpSocket.createConnection as jest.Mock;

        scanCompletePromise = new Promise((resolve) => {
            scanCompleteResolve = resolve;
        });

        // Intercept setTimeout to stop recursion and signal completion
        global.setTimeout = ((cb: Function, delay: number) => {
            if (delay === 1500) {
                // This is the recursion delay in findSenderAndConnect
                // We stop recursion here and resolve our promise
                scanCompleteResolve();
                return { hasRef: () => false } as any; // Dummy timeout object
            }
            return originalSetTimeout(cb, delay);
        }) as any;
    });

    afterEach(() => {
        global.setTimeout = originalSetTimeout;
        TransferClient.stop();
    });

    it('measures discovery time', async () => {
        createConnectionMock.mockImplementation((options: any, callback: any) => {
            const client = {
                on: jest.fn((event, cb) => {
                    if (event === 'error') {
                        // Simulate connection timeout/error after a delay
                        // Use originalSetTimeout to avoid our interceptor if needed,
                        // but 100ms != 1500ms so it's fine.
                        originalSetTimeout(() => {
                            cb(new Error('Connection failed'));
                        }, 100);
                    }
                }),
                destroy: jest.fn(),
                write: jest.fn(),
            };
            return client;
        });

        const client: any = TransferClient;
        client.shouldStop = false;

        const ipSet = new Set<string>();
        for(let i=0; i<20; i++) {
            ipSet.add(`192.168.1.${i+10}`);
        }

        const startTime = Date.now();

        // Start discovery. We don't await it because it's recursive (normally).
        // But with our mock, it will finish one pass and try to schedule next.
        // We await our scanCompletePromise which triggers when recursion would happen.
        client.findSenderAndConnect(ipSet, 8888, '/tmp', 1);

        await scanCompletePromise;

        const duration = Date.now() - startTime;
        console.log(`Scan took ${duration}ms`);

        // With batch size 10, 20 IPs, 100ms delay => ~200ms
        // We expect it to be significantly faster than 1000ms.
        expect(duration).toBeLessThan(500);

    }, 10000);
});
