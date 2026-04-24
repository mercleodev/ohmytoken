import type { HudEvent } from "./events";
import type { EventBusServer } from "./server";

// The HUD event bus has a single, process-global emit surface so that emit
// sites spread across electron/proxy, electron/watcher, electron/providers,
// and electron/store can stay decoupled from the server lifecycle. The main
// process wires the server up once on app ready (P0-4) via
// bindEventBusServer(); until then, emit() is a silent no-op so early boot
// code never crashes waiting on the bus.

let boundServer: EventBusServer | null = null;
let enabled = true;

export function bindEventBusServer(server: EventBusServer | null): void {
  boundServer = server;
}

export function setEventBusEnabled(flag: boolean): void {
  enabled = flag;
}

export function isEventBusEnabled(): boolean {
  return enabled;
}

export function emit(event: HudEvent): void {
  if (!enabled) {
    return;
  }
  const server = boundServer;
  if (!server) {
    return;
  }
  server.emit(event);
}

export function resetEventBusClient(): void {
  boundServer = null;
  enabled = true;
}
