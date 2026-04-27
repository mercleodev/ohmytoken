import * as http from "http";
import * as https from "https";
import * as crypto from "crypto";
import { SseParser } from "./sseParser";
import { parseRequestMeta } from "./requestParser";
import { calculateCost } from "./costCalculator";
import { writeUsageLog } from "./usageWriter";
import { buildPromptScan } from "./scanBuilder";
import { writeScanLog } from "./scanWriter";
import { PendingUsage, PromptScan, ProxyStatus, UsageLogEntry } from "./types";
import {
  emitClaudeProxyMessageDelta,
  emitClaudeProxyMessageStop,
} from "../eventBus/providers/claudeProxyEmit";
import { accumulateActiveSessionTokens } from "../eventBus/sessionState";

const DEFAULT_PORT = 8780;
const ANTHROPIC_HOST = "api.anthropic.com";

export type ProxyOptions = {
  port?: number;
  upstream?: string; // 'host:port' (http) or 'api.anthropic.com' (https)
  resolveSessionId?: () => string;
  onScanComplete?: (scan: PromptScan, usage: UsageLogEntry) => void;
  /** Called after evidence scoring is complete (async) */
  onEvidenceScored?: (scan: PromptScan) => void;
  /** Evidence engine instance (injected from main process) */
  evidenceEngine?: import('../evidence/engine').EvidenceEngine;
  /** System field content cache for evidence scoring */
  getSystemContents?: (body: string) => Record<string, string>;
  /** Previous evidence scores for session history signal */
  getPreviousScores?: (sessionId: string) => Record<string, number[]>;
};

let proxyServer: http.Server | null = null;
let sessionId = crypto.randomUUID();
let requestsTotal = 0;
let errorsTotal = 0;
let currentUpstream: string | null = null;
let currentPort: number | null = null;

const isHttpsUpstream = (upstream: string): boolean =>
  upstream === ANTHROPIC_HOST || upstream.endsWith(".anthropic.com");

const forwardRequest = (
  req: http.IncomingMessage,
  body: string,
  upstream: string,
  onResponse: (proxyRes: http.IncomingMessage) => void,
  onError: (err: Error) => void,
): void => {
  const useHttps = isHttpsUpstream(upstream);
  const [host, portStr] = upstream.split(":");
  const port = portStr ? parseInt(portStr, 10) : useHttps ? 443 : 80;

  const headers = { ...req.headers };
  headers.host = host;
  delete headers["transfer-encoding"];
  headers["content-length"] = Buffer.byteLength(body).toString();

  const options: http.RequestOptions = {
    hostname: host,
    port,
    path: req.url,
    method: req.method,
    headers,
  };

  const transport = useHttps ? https : http;
  const proxyReq = transport.request(options, onResponse);

  proxyReq.on("error", onError);
  proxyReq.write(body);
  proxyReq.end();
};

const handleRequest = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstream: string,
  options: ProxyOptions,
): void => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    requestsTotal++;

    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const meta = parseRequestMeta(body);
    const isMessages = req.url === "/v1/messages";

    const resolvedSessionId = options.resolveSessionId?.() || sessionId;

    const pending: PendingUsage = {
      request_id: requestId,
      session_id: resolvedSessionId,
      model: meta.model,
      request_meta: meta,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      started_at: new Date().toISOString(),
    };

    const sseParser = isMessages ? new SseParser() : null;
    console.log(
      `[proxy] ${req.method} ${req.url} | isMessages=${isMessages} | model=${meta.model}`,
    );

    // P1-5 (gate doc §8) tracks the running baseline so we can convert
    // per-request `cumulative_*` values into per-event deltas before
    // forwarding them to `accumulateActiveSessionTokens`. This keeps
    // sessionState's running totals incremental — no double counting on
    // message_stop, no zero-jump during the live stream.
    let accumulatedOutputTokens = 0;
    let accumulatedCostUsd = 0;

    const processSseEvents = (
      events: import("./types").SseEvent[],
      source: string,
    ) => {
      for (const evt of events) {
        if (evt.type === "message_start") {
          pending.input_tokens = evt.input_tokens ?? 0;
          pending.cache_creation_input_tokens =
            evt.cache_creation_input_tokens ?? 0;
          pending.cache_read_input_tokens = evt.cache_read_input_tokens ?? 0;
          console.log(
            `[proxy] SSE message_start | input=${pending.input_tokens} cache_create=${pending.cache_creation_input_tokens} cache_read=${pending.cache_read_input_tokens}`,
          );
        }
        if (evt.type === "message_delta") {
          const prevOutputTokens = pending.output_tokens;
          pending.output_tokens = evt.output_tokens ?? 0;
          try {
            const cumulativeCost = calculateCost(
              pending.model,
              pending.input_tokens,
              pending.output_tokens,
              pending.cache_creation_input_tokens,
              pending.cache_read_input_tokens,
            );
            emitClaudeProxyMessageDelta({
              requestId: pending.request_id,
              deltaOutputTokens: pending.output_tokens - prevOutputTokens,
              cumulativeOutputTokens: pending.output_tokens,
              cumulativeCostUsd: cumulativeCost,
            });
            try {
              accumulateActiveSessionTokens({
                session_id: pending.session_id,
                output_tokens_delta:
                  pending.output_tokens - accumulatedOutputTokens,
                cost_usd_delta: cumulativeCost - accumulatedCostUsd,
              });
              accumulatedOutputTokens = pending.output_tokens;
              accumulatedCostUsd = cumulativeCost;
            } catch {
              // Accumulator failures must not break SSE passthrough
              // (gate doc §8 P1-5).
            }
          } catch {
            // Emit failures must not break SSE passthrough (gate doc §8 P1-3).
          }
        }
        if (evt.type === "message_stop") {
          console.log(
            `[proxy] SSE message_stop (${source}) | building scan...`,
          );
          const duration = Date.now() - startTime;
          const cost = calculateCost(
            pending.model,
            pending.input_tokens,
            pending.output_tokens,
            pending.cache_creation_input_tokens,
            pending.cache_read_input_tokens,
          );

          try {
            emitClaudeProxyMessageStop({
              requestId: pending.request_id,
              finalOutputTokens: pending.output_tokens,
              finalCostUsd: cost,
            });
            try {
              // Top-up the accumulator with whatever residual the final
              // calculation revealed beyond the last delta event (often
              // zero for token, small for cost). Accumulator drops the
              // call if the active session changed mid-request.
              accumulateActiveSessionTokens({
                session_id: pending.session_id,
                output_tokens_delta:
                  pending.output_tokens - accumulatedOutputTokens,
                cost_usd_delta: cost - accumulatedCostUsd,
              });
              accumulatedOutputTokens = pending.output_tokens;
              accumulatedCostUsd = cost;
            } catch {
              // Accumulator failures must not break SSE passthrough
              // (gate doc §8 P1-5).
            }
          } catch {
            // Emit failures must not break SSE passthrough (gate doc §8 P1-3).
          }

          const entry: UsageLogEntry = {
            timestamp: new Date().toISOString(),
            request_id: pending.request_id,
            session_id: pending.session_id,
            model: pending.model,
            request: {
              messages_count: pending.request_meta.messages_count,
              tools_count: pending.request_meta.tools_count,
              has_system: pending.request_meta.has_system,
              max_tokens: pending.request_meta.max_tokens,
            },
            response: {
              input_tokens: pending.input_tokens,
              output_tokens: pending.output_tokens,
              cache_creation_input_tokens: pending.cache_creation_input_tokens,
              cache_read_input_tokens: pending.cache_read_input_tokens,
            },
            cost_usd: cost,
            duration_ms: duration,
          };

          writeUsageLog(entry);

          try {
            const scan = buildPromptScan(
              body,
              pending.request_id,
              pending.session_id,
            );
            if (scan) {
              writeScanLog(scan);
              options.onScanComplete?.(scan, entry);
              console.log(
                `[proxy] Scan written (${source}): ${scan.user_prompt.slice(0, 50)}...`,
              );

              // Async evidence scoring (non-blocking)
              if (options.evidenceEngine) {
                try {
                  const fileContents = options.getSystemContents?.(body) ?? {};
                  const previousScores = options.getPreviousScores?.(scan.session_id) ?? {};
                  const report = options.evidenceEngine.score(scan, {
                    fileContents,
                    previousScores,
                  });
                  scan.evidence_report = report;
                  options.onEvidenceScored?.(scan);
                  console.log(
                    `[proxy] Evidence scored: ${report.files.length} files, method=${report.fusion_method}`,
                  );
                } catch (evidenceErr) {
                  console.error("[proxy] Evidence scoring error:", evidenceErr);
                }
              }
            } else {
              console.warn("[proxy] buildPromptScan returned null");
            }
          } catch (scanErr) {
            console.error("[proxy] CT scan error:", scanErr);
          }
        }
      }
    };

    forwardRequest(
      req,
      body,
      upstream,
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);

        proxyRes.on("data", (chunk: Buffer) => {
          res.write(chunk);

          if (sseParser && isMessages) {
            try {
              processSseEvents(
                sseParser.processChunk(chunk.toString("utf-8")),
                "stream",
              );
            } catch {
              // Side parsing errors do not affect passthrough
            }
          }
        });

        proxyRes.on("end", () => {
          // Process remaining SSE events in buffer (when message_stop arrives without trailing \n\n)
          if (sseParser && isMessages) {
            try {
              processSseEvents(sseParser.flush(), "flush");
            } catch {
              // Flush errors do not affect passthrough
            }
          }
          res.end();
        });
      },
      (err) => {
        errorsTotal++;
        console.error(`Proxy error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Bad Gateway", message: err.message }),
          );
        }
      },
    );
  });
};

export const startProxyServer = (options: ProxyOptions = {}): http.Server => {
  const port = options.port ?? DEFAULT_PORT;
  const upstream = options.upstream ?? ANTHROPIC_HOST;

  if (proxyServer) {
    throw new Error("Proxy server is already running");
  }

  sessionId = crypto.randomUUID();
  requestsTotal = 0;
  errorsTotal = 0;
  currentUpstream = upstream;
  currentPort = port;

  proxyServer = http.createServer((req, res) => {
    handleRequest(req, res, upstream, options);
  });

  proxyServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[Proxy] Port ${port} already in use — proxy disabled`);
      proxyServer = null;
    } else {
      console.error("[Proxy] Server error:", err);
    }
  });

  proxyServer.listen(port, () => {
    console.log(
      `Proxy server listening on port ${port}, upstream: ${upstream}`,
    );
  });

  return proxyServer;
};

export const stopProxyServer = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!proxyServer) {
      resolve();
      return;
    }

    proxyServer.close((err) => {
      proxyServer = null;
      currentUpstream = null;
      currentPort = null;
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

export const getSessionId = (): string => sessionId;

export const getProxyStatus = (): ProxyStatus => ({
  running: proxyServer !== null,
  port: currentPort,
  upstream: currentUpstream,
  requests_total: requestsTotal,
  errors_total: errorsTotal,
});

// Direct CLI execution
if (require.main === module) {
  const port = parseInt(process.argv[2] || String(DEFAULT_PORT), 10);
  const upstream = process.argv[3] || ANTHROPIC_HOST;
  startProxyServer({ port, upstream });
}
