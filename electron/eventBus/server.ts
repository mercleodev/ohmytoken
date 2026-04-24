import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { matchEventType, type HudEvent } from "./events";

export interface SnapshotPayload {
  current_session:
    | { provider: string; session_id: string; ctx_estimate: number }
    | null;
}

export interface EventBusLogger {
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  error?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface EventBusServerOptions {
  port: number;
  token?: string | null;
  getSnapshot?: () => SnapshotPayload;
  logger?: EventBusLogger;
}

export interface EventBusServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  emit(event: HudEvent): void;
  readonly port: number;
  readonly address: { address: string; port: number };
  readonly clientCount: number;
}

const LOOPBACK_HOST = "127.0.0.1";
const AUTH_CLOSE_CODE = 1008;
const SHUTDOWN_CLOSE_CODE = 1001;

type OutboundFrame =
  | { op: "snapshot"; current_session: SnapshotPayload["current_session"] }
  | { op: "event"; payload: HudEvent }
  | { op: "error"; code: "auth" };

export function createEventBusServer(
  options: EventBusServerOptions,
): EventBusServer {
  const token = options.token ?? null;
  const getSnapshot =
    options.getSnapshot ?? ((): SnapshotPayload => ({ current_session: null }));
  const logger = options.logger;

  const subscribers = new Map<WebSocket, readonly string[]>();
  let wss: WebSocketServer | null = null;

  const authorize = (req: IncomingMessage): boolean => {
    if (!token) {
      return true;
    }
    const host = req.headers.host ?? `${LOOPBACK_HOST}`;
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.searchParams.get("token") === token) {
      return true;
    }
    const protoHeader = req.headers["sec-websocket-protocol"];
    if (typeof protoHeader === "string") {
      const protocols = protoHeader.split(",").map((p) => p.trim());
      if (protocols.includes(`ohtoken.${token}`)) {
        return true;
      }
    }
    return false;
  };

  const handleMessage = (ws: WebSocket, raw: RawData): void => {
    let frame: unknown;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!isPlainObject(frame)) {
      return;
    }
    const op = frame.op;
    if (op !== "subscribe") {
      return;
    }
    const types = frame.types;
    if (!Array.isArray(types) || !types.every((t) => typeof t === "string")) {
      return;
    }
    subscribers.set(ws, [...(types as string[])]);
    sendFrame(ws, { op: "snapshot", ...getSnapshot() });
  };

  return {
    start(): Promise<void> {
      if (wss) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        const server = new WebSocketServer({
          host: LOOPBACK_HOST,
          port: options.port,
        });
        const onError = (err: Error) => {
          server.off("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server.off("error", onError);
          wss = server;
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);

        server.on("connection", (ws, req) => {
          if (!authorize(req)) {
            logger?.warn?.("eventBus: rejected connection — token mismatch");
            ws.send(JSON.stringify({ op: "error", code: "auth" }), () => {
              ws.close(AUTH_CLOSE_CODE, "auth");
            });
            return;
          }
          subscribers.set(ws, []);
          ws.on("message", (raw) => handleMessage(ws, raw));
          ws.on("close", () => {
            subscribers.delete(ws);
          });
          ws.on("error", (err) => {
            logger?.warn?.("eventBus: client error", { message: err.message });
          });
        });
      });
    },

    stop(): Promise<void> {
      const server = wss;
      if (!server) {
        return Promise.resolve();
      }
      for (const ws of subscribers.keys()) {
        try {
          ws.close(SHUTDOWN_CLOSE_CODE, "server stopping");
          // Force-kill any client that does not finish the close handshake
          // promptly so stop() cannot hang the process during shutdown.
          setTimeout(() => {
            if (ws.readyState !== WebSocket.CLOSED) {
              ws.terminate();
            }
          }, 50);
        } catch {
          // ignore — socket may already be dead
        }
      }
      subscribers.clear();
      return new Promise<void>((resolve) => {
        server.close(() => {
          wss = null;
          resolve();
        });
      });
    },

    emit(event: HudEvent): void {
      for (const [ws, patterns] of subscribers) {
        if (patterns.some((p) => matchEventType(p, event.type))) {
          sendFrame(ws, { op: "event", payload: event });
        }
      }
    },

    get port() {
      return readAddress(wss).port;
    },

    get address() {
      return readAddress(wss);
    },

    get clientCount() {
      return subscribers.size;
    },
  };
}

function sendFrame(ws: WebSocket, frame: OutboundFrame): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAddress(server: WebSocketServer | null): {
  address: string;
  port: number;
} {
  if (!server) {
    return { address: "", port: 0 };
  }
  const info = server.address();
  if (info && typeof info === "object") {
    const addr = info as AddressInfo;
    return { address: addr.address, port: addr.port };
  }
  return { address: "", port: 0 };
}
