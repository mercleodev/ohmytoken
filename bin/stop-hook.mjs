#!/usr/bin/env node
/* global process, Buffer, setTimeout */
/**
 * OhMyToken Stop hook (issue #343).
 *
 * Reads the hook stdin payload Claude Code writes when an assistant turn
 * ends (`{ session_id, transcript_path, hook_event_name, ... }`) and POSTs
 * a small request to the local Electron `/api/scan/from-transcript`
 * endpoint. The Electron side reads the JSONL transcript, builds a
 * PromptScan from the latest turn (CLAUDE.md context + Anthropic-reported
 * usage), and persists it tagged `source='hook'`.
 *
 * Failure modes are intentionally silent: if Electron is not running,
 * unreachable, or returns an error, this script must still exit 0 so
 * `claude` is never blocked by the OhMyToken capture path.
 */

import http from "node:http";

const ENDPOINT_HOST = process.env.OHT_HOOK_HOST || "127.0.0.1";
const ENDPOINT_PORT = Number(process.env.OHT_HOOK_PORT || "8780");
const ENDPOINT_PATH = "/api/scan/from-transcript";
const REQUEST_TIMEOUT_MS = 1500;

const readStdin = () =>
  new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", () => resolve(buf));
    setTimeout(() => resolve(buf), REQUEST_TIMEOUT_MS).unref();
  });

const main = async () => {
  let payload;
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }

  const sessionId = payload.session_id;
  const transcriptPath = payload.transcript_path;
  if (!transcriptPath) process.exit(0);

  const body = JSON.stringify({
    session_id: sessionId,
    transcript_path: transcriptPath,
  });

  const req = http.request(
    {
      host: ENDPOINT_HOST,
      port: ENDPOINT_PORT,
      method: "POST",
      path: ENDPOINT_PATH,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body).toString(),
      },
      timeout: REQUEST_TIMEOUT_MS,
    },
    (res) => {
      res.on("data", () => {});
      res.on("end", () => process.exit(0));
    },
  );
  req.on("error", () => process.exit(0));
  req.on("timeout", () => {
    req.destroy();
    process.exit(0);
  });
  req.write(body);
  req.end();
};

main().catch(() => process.exit(0));
