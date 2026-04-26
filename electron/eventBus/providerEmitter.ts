// P1-1 ProviderEmitter contract (gate doc §8). Each provider that wants to
// participate in the HUD pipeline (Claude in Phase 1; Codex/Gemini once the
// contract is stable) implements this interface and registers itself once
// during app boot. The registry is intentionally process-global so the
// main-process boot path can wire emitters without threading a container
// through every module — emit fan-out itself remains owned by the existing
// client.ts/server.ts layer (P0-3, P0-2).

import type { Provider } from "./events";

export interface ProviderEmitter {
  readonly id: Provider;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

const registry = new Map<Provider, ProviderEmitter>();

export function registerProviderEmitter(emitter: ProviderEmitter): void {
  if (registry.has(emitter.id)) {
    throw new Error(
      `ProviderEmitter already registered for "${emitter.id}"`,
    );
  }
  registry.set(emitter.id, emitter);
}

export function getProviderEmitter(
  id: Provider,
): ProviderEmitter | undefined {
  return registry.get(id);
}

export function getRegisteredProviders(): readonly Provider[] {
  return Array.from(registry.keys());
}

export async function startAllProviderEmitters(): Promise<void> {
  for (const emitter of registry.values()) {
    await emitter.start();
  }
}

export async function stopAllProviderEmitters(): Promise<void> {
  for (const emitter of registry.values()) {
    await emitter.stop();
  }
}

export function resetProviderEmitterRegistry(): void {
  registry.clear();
}
