export type MemoryCardProvider = 'claude' | 'codex';

export const supportsMemoryCard = (
  provider: string | undefined,
): provider is MemoryCardProvider =>
  provider === 'claude' || provider === 'codex';

export const memoryCardLabel = (provider: MemoryCardProvider): string =>
  provider === 'codex' ? 'Codex Memory' : 'Claude Memory';

export const supportsMultiProjectMemory = (
  provider: MemoryCardProvider,
): boolean => provider === 'claude';
