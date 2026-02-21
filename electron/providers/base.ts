import { ProviderConfig, UsageData } from '../types';

export abstract class BaseProvider {
  protected id: string;
  protected name: string;
  protected type: string;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
  }

  abstract fetchUsage(): Promise<UsageData>;

  abstract validate(): Promise<{ valid: boolean; error?: string }>;

  getName(): string {
    return this.name;
  }

  getId(): string {
    return this.id;
  }
}
