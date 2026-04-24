import { bindEventBusServer } from "./client";
import {
  createEventBusServer,
  type EventBusServer,
  type SnapshotPayload,
} from "./server";

// The design fixes the HUD event bus to port 8781 (idea/terminal-hud-plugin.md
// §15 Q2 — "fixed, not dynamic"). Exposing this as a named export keeps
// electron/main.ts and the future TUI/statusLine clients in sync on a single
// source of truth.
export const DEFAULT_EVENT_BUS_PORT = 8781;

export interface EventBusBootOptions {
  port: number;
  enabled: boolean;
  token?: string | null;
  getSnapshot?: () => SnapshotPayload;
}

export async function bootEventBus(
  options: EventBusBootOptions,
): Promise<EventBusServer | null> {
  if (!options.enabled) {
    return null;
  }
  const server = createEventBusServer({
    port: options.port,
    token: options.token ?? null,
    getSnapshot: options.getSnapshot,
  });
  await server.start();
  bindEventBusServer(server);
  return server;
}

export async function shutdownEventBus(
  server: EventBusServer | null,
): Promise<void> {
  if (!server) {
    return;
  }
  bindEventBusServer(null);
  await server.stop();
}
