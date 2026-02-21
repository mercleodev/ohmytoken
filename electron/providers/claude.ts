import { BaseProvider } from './base';
import { ProviderConfig, UsageData } from '../types';
import { BrowserWindow } from 'electron';

type ClaudeApiResponse = {
  five_hour?: {
    utilization?: number;
    resets_at?: string;
  };
  seven_day?: {
    utilization?: number;
    resets_at?: string;
  };
};

export class ClaudeProvider extends BaseProvider {
  private organizationId: string;
  private sessionKey: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.organizationId = config.organizationId || '';
    this.sessionKey = config.sessionKey || '';
  }

  async fetchUsage(): Promise<UsageData> {
    const url = `https://claude.ai/api/organizations/${this.organizationId}/usage`;

    // Use a hidden BrowserWindow to run fetch in browser environment
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    try {
      // Set cookies first
      await win.webContents.session.cookies.set({
        url: 'https://claude.ai',
        name: 'sessionKey',
        value: this.sessionKey,
        domain: '.claude.ai',
        path: '/',
        secure: true,
        httpOnly: true
      });

      // Load claude.ai then execute (CORS bypass)
      await win.loadURL('https://claude.ai');

      // Execute fetch in browser environment
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            const response = await fetch('${url}', {
              method: 'GET',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json'
              }
            });

            if (!response.ok) {
              return { error: true, status: response.status };
            }

            return await response.json();
          } catch (e) {
            return { error: true, message: e.message };
          }
        })()
      `);

      if (result.error) {
        if (result.status === 401 || result.status === 403) {
          throw new Error('Authentication failed. Please check your Session Key.');
        }
        throw new Error(result.message || `API error: ${result.status}`);
      }

      const data = result as ClaudeApiResponse;

      return {
        fiveHour: data.five_hour ? {
          utilization: data.five_hour.utilization ?? 0,
          resetsAt: data.five_hour.resets_at ?? null
        } : undefined,
        sevenDay: data.seven_day ? {
          utilization: data.seven_day.utilization ?? 0,
          resetsAt: data.seven_day.resets_at ?? null
        } : undefined
      };
    } finally {
      win.destroy();
    }
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.fetchUsage();
      return { valid: true };
    } catch (error) {
      return { valid: false, error: (error as Error).message };
    }
  }
}
