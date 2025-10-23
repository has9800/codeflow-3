import { randomBytes } from 'crypto';

interface DeviceCodeFlowOptions {
  verificationUri?: string;
  manualOnly?: boolean;
  authServer?: string;
  clientId?: string;
  fetchFn?: typeof fetch;
  pollingTimeoutMs?: number;
}

interface DeviceCodeResult {
  apiKey?: string;
  accountLabel?: string;
  cancelled?: boolean;
}

interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInMs: number;
  intervalMs: number;
}

interface TokenResponse {
  access_token: string;
  account_label?: string;
  account?: string;
}

type TokenError =
  | 'authorization_pending'
  | 'slow_down'
  | 'expired_token'
  | 'access_denied';

const DEFAULT_CLIENT_ID = 'codeflow-cli';
const DEFAULT_POLLING_TIMEOUT = 10 * 60 * 1000; // 10 minutes

export class DeviceCodeFlow {
  private readonly verificationUri: string;
  private readonly manualOnly: boolean;
  private readonly authServer?: string;
  private readonly clientId: string;
  private readonly fetchFn: typeof fetch;
  private readonly pollingTimeoutMs: number;

  constructor(options: DeviceCodeFlowOptions = {}) {
    this.verificationUri = options.verificationUri ?? 'https://app.codeflow.dev/activate';
    this.manualOnly = Boolean(options.manualOnly);
    this.authServer = options.authServer ?? process.env.CODEFLOW_AUTH_SERVER;
    this.clientId = options.clientId ?? DEFAULT_CLIENT_ID;
    this.fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
    this.pollingTimeoutMs = options.pollingTimeoutMs ?? DEFAULT_POLLING_TIMEOUT;

    if (!this.fetchFn) {
      throw new Error('Global fetch is not available in this environment.');
    }
  }

  async authenticate(): Promise<DeviceCodeResult> {
    if (this.manualOnly) {
      return this.promptForApiKey();
    }

    if (!this.authServer) {
      return this.promptForApiKey();
    }

    try {
      const deviceInfo = await this.requestDeviceCode();
      this.printInstructions(deviceInfo);
      const token = await this.pollForToken(deviceInfo);

      if (token?.apiKey) {
        return token;
      }

      console.warn('Device authorisation timed out. Please enter the API key manually.');
      return this.promptForApiKey('Enter the API key issued after authorisation:');
    } catch (error) {
      console.warn(
        'Device-code authentication failed:',
        error instanceof Error ? error.message : String(error)
      );
      return this.promptForApiKey();
    }
  }

  private async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const response = await this.fetchFn(`${this.authServer}/oauth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to request device code (${response.status})`);
    }

    const payload = await response.json();
    return {
      deviceCode: payload.device_code,
      userCode: payload.user_code ?? this.generateUserCode(),
      verificationUri: payload.verification_uri ?? this.verificationUri,
      verificationUriComplete: payload.verification_uri_complete,
      expiresInMs: (payload.expires_in ?? 600) * 1000,
      intervalMs: Math.max((payload.interval ?? 5) * 1000, 1000),
    };
  }

  private async pollForToken(deviceInfo: DeviceCodeResponse): Promise<DeviceCodeResult | undefined> {
    const deadline = Date.now() + Math.min(this.pollingTimeoutMs, deviceInfo.expiresInMs);
    let interval = deviceInfo.intervalMs;

    while (Date.now() < deadline) {
      await delay(interval);

      const response = await this.fetchFn(`${this.authServer}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.clientId,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceInfo.deviceCode,
        }),
      });

      if (response.ok) {
        const token = (await response.json()) as TokenResponse;
        return {
          apiKey: token.access_token,
          accountLabel: token.account_label ?? token.account,
        };
      }

      const errorPayload = await safeParse(await response.text());
      const errorCode = errorPayload?.error as TokenError | undefined;

      switch (errorCode) {
        case 'authorization_pending':
          continue;
        case 'slow_down':
          interval += 2000;
          continue;
        case 'expired_token':
          return undefined;
        case 'access_denied':
          return { cancelled: true };
        default:
          throw new Error(`Unexpected device token response: ${response.status}`);
      }
    }

    return undefined;
  }

  private async promptForApiKey(message = 'Paste your OpenRouter API key:'): Promise<DeviceCodeResult> {
    const { default: inquirer } = await import('inquirer');

    const answers = await inquirer.prompt<{
      apiKey: string;
      accountLabel?: string;
    }>([
      {
        type: 'password',
        name: 'apiKey',
        message,
        mask: '*',
        validate: (input: string) => input.trim().length > 0 || 'API key is required',
      },
      {
        type: 'input',
        name: 'accountLabel',
        message: 'Optional account label (email or name):',
      },
    ]);

    return {
      apiKey: answers.apiKey.trim(),
      accountLabel: answers.accountLabel?.trim() || undefined,
    };
  }

  private printInstructions(deviceInfo: DeviceCodeResponse): void {
    const verificationUri = deviceInfo.verificationUriComplete ?? deviceInfo.verificationUri;
    const lines = [
      '',
      'To authenticate CodeFlow:',
      `  1. Open ${verificationUri} in your browser.`,
      `  2. Enter the code: ${deviceInfo.userCode}`,
      '  3. Authorise access to your CodeFlow account.',
      '  4. Return to this terminal once authorisation is complete.',
      '',
      'Waiting for authorisation...',
    ];
    console.log(lines.join('\n'));
  }

  private generateUserCode(): string {
    const bytes = randomBytes(4).toString('hex').toUpperCase();
    return `${bytes.slice(0, 4)}-${bytes.slice(4)}`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeParse(payload: string): Record<string, unknown> | null {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
