import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { DeviceCodeFlow } from '../../src/auth/DeviceCodeFlow.js';

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(async () => ({ apiKey: 'manual-key', accountLabel: 'Manual User' })),
  },
}));

const { default: inquirer } = await import('inquirer');
const promptMock = inquirer.prompt as unknown as Mock;

describe('DeviceCodeFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    promptMock.mockClear();
    promptMock.mockResolvedValue({ apiKey: 'manual-key', accountLabel: 'Manual User' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to manual entry when auth server is unavailable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network unavailable');
    });

    const flow = new DeviceCodeFlow({ authServer: 'https://auth.example', fetchFn: fetchMock });
    const promise = flow.authenticate();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.apiKey).toBe('manual-key');
    expect(promptMock).toHaveBeenCalled();
  });

  it('polls device code endpoint and returns issued API key', async () => {
    const responses = [
      new Response(
        JSON.stringify({
          device_code: 'device-code-123',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://verify.example',
          expires_in: 600,
          interval: 1,
        }),
        { status: 200 }
      ),
      new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 }),
      new Response(
        JSON.stringify({ access_token: 'issued-api-key', account_label: 'bot@example.com' }),
        { status: 200 }
      ),
    ];

    const fetchMock = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error('unexpected fetch call');
      return next;
    });

    const flow = new DeviceCodeFlow({ authServer: 'https://auth.example', fetchFn: fetchMock });
    const authPromise = flow.authenticate();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await authPromise;
    expect(result.apiKey).toBe('issued-api-key');
    expect(result.accountLabel).toBe('bot@example.com');
    expect(promptMock).not.toHaveBeenCalled();
  });
});
