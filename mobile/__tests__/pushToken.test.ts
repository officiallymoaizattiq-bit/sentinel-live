/**
 * Tests for src/notifications/pushToken.ts.
 *
 * We can't easily reach into expo-notifications at runtime under jest, so we
 * mock the surface area we use: getExpoPushTokenAsync, addPushTokenListener,
 * and the api.registerPushToken HTTP call. The goal is to lock in:
 *   - we early-return null on emulator / missing perms / missing projectId
 *   - we POST the right payload shape on the happy path
 *   - the rotation listener re-POSTs without re-checking permissions
 */

const mockGetExpoPushTokenAsync = jest.fn();
const mockAddPushTokenListener = jest.fn();
const mockRegisterPushToken = jest.fn();
const mockEnsurePermission = jest.fn();

let mockIsDevice = true;
let mockProjectId: string | null = 'proj-123';

jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
  addPushTokenListener: (cb: (e: { data: string }) => void) => {
    mockAddPushTokenListener(cb);
    return { remove: jest.fn() };
  },
}));

jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockProjectId ? { extra: { eas: { projectId: mockProjectId } } } : {};
    },
    easConfig: null,
  },
}));

jest.mock('../src/config', () => ({
  config: { apiUrl: 'http://test.local:8000' },
}));

jest.mock('../src/api/client', () => ({
  api: {
    registerPushToken: (...args: unknown[]) => mockRegisterPushToken(...args),
  },
  ApiCallError: class ApiCallError extends Error {
    error: { kind: string };
    constructor(error: { kind: string }) {
      super('mock');
      this.error = error;
    }
  },
}));

jest.mock('../src/notifications/incoming', () => ({
  ensureNotificationPermission: () => mockEnsurePermission(),
}));

import {
  getPushToken,
  registerPushToken,
  subscribeToPushTokenRefresh,
} from '../src/notifications/pushToken';
import type { Credentials } from '../src/auth/storage';

const creds: Credentials = {
  deviceToken: 't',
  patientId: 'p1',
  deviceId: 'd1',
  pairTime: '2026-04-18T00:00:00Z',
};

beforeEach(() => {
  mockGetExpoPushTokenAsync.mockReset();
  mockAddPushTokenListener.mockReset();
  mockRegisterPushToken.mockReset();
  mockEnsurePermission.mockReset();
  mockIsDevice = true;
  mockProjectId = 'proj-123';
});

describe('getPushToken', () => {
  it('returns null on emulator', async () => {
    mockIsDevice = false;
    expect(await getPushToken()).toBeNull();
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('returns null when permission denied', async () => {
    mockEnsurePermission.mockResolvedValue(false);
    expect(await getPushToken()).toBeNull();
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('returns null when projectId is missing', async () => {
    mockEnsurePermission.mockResolvedValue(true);
    mockProjectId = null;
    expect(await getPushToken()).toBeNull();
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('passes the projectId through and returns the token', async () => {
    mockEnsurePermission.mockResolvedValue(true);
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    const out = await getPushToken();
    expect(mockGetExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
    expect(out).toEqual({
      token: 'ExponentPushToken[abc]',
      provider: 'expo',
      platform: expect.any(String),
    });
  });

  it('swallows expo errors and returns null', async () => {
    mockEnsurePermission.mockResolvedValue(true);
    mockGetExpoPushTokenAsync.mockRejectedValue(new Error('expo down'));
    expect(await getPushToken()).toBeNull();
  });
});

describe('registerPushToken', () => {
  it('skips POST when no token is available', async () => {
    mockIsDevice = false;
    await registerPushToken(creds);
    expect(mockRegisterPushToken).not.toHaveBeenCalled();
  });

  it('POSTs token to backend on happy path', async () => {
    mockEnsurePermission.mockResolvedValue(true);
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[xyz]' });
    mockRegisterPushToken.mockResolvedValue({ ok: true });
    await registerPushToken(creds);
    expect(mockRegisterPushToken).toHaveBeenCalledTimes(1);
    const [c, body] = mockRegisterPushToken.mock.calls[0];
    expect(c).toBe(creds);
    expect(body.token).toBe('ExponentPushToken[xyz]');
    expect(body.provider).toBe('expo');
    expect(['ios', 'android']).toContain(body.platform);
  });

  it('rethrows auth errors so root layout can route to pair screen', async () => {
    mockEnsurePermission.mockResolvedValue(true);
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[xyz]' });
    const { ApiCallError } = jest.requireMock('../src/api/client');
    mockRegisterPushToken.mockRejectedValue(
      new ApiCallError({ kind: 'auth', code: 'device_revoked' }),
    );
    await expect(registerPushToken(creds)).rejects.toBeInstanceOf(ApiCallError);
  });

  it('swallows non-auth network errors', async () => {
    mockEnsurePermission.mockResolvedValue(true);
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[xyz]' });
    mockRegisterPushToken.mockRejectedValue(new Error('network blip'));
    await expect(registerPushToken(creds)).resolves.toBeUndefined();
  });
});

describe('subscribeToPushTokenRefresh', () => {
  it('re-registers the rotated token without permission re-check', () => {
    mockRegisterPushToken.mockResolvedValue({ ok: true });
    subscribeToPushTokenRefresh(creds);
    expect(mockAddPushTokenListener).toHaveBeenCalledTimes(1);
    const cb = mockAddPushTokenListener.mock.calls[0][0] as (e: { data: string }) => void;
    cb({ data: 'ExponentPushToken[rotated]' });
    expect(mockRegisterPushToken).toHaveBeenCalledTimes(1);
    const [, body] = mockRegisterPushToken.mock.calls[0];
    expect(body.token).toBe('ExponentPushToken[rotated]');
    expect(mockEnsurePermission).not.toHaveBeenCalled();
  });
});
