import type { PromptScan, UsageLogEntry } from "../proxy/types";
import { scanFromTranscript } from "./scanFromTranscript";
import { waitForTranscriptSettle } from "./transcriptReader";
import type { TranscriptSettleOptions, TranscriptUsage } from "./transcriptReader";

export type HandleScanDeps = {
  writeHookScan: (scan: PromptScan, usage: UsageLogEntry) => void;
  globalClaudeMdPath?: string;
  /**
   * Issue #349: Claude Code's Stop hook fires before the runner flushes
   * the final assistant message + nested_memory attachments. Wait for
   * the JSONL byte size to hold steady before parsing.
   */
  settleOptions?: TranscriptSettleOptions;
};

export type HandleScanResponse = { status: number; body: string };

const json = (obj: unknown): string => JSON.stringify(obj);

export const buildHookUsageEntry = (
  scan: PromptScan,
  usage: TranscriptUsage,
): UsageLogEntry => ({
  timestamp: scan.timestamp,
  request_id: scan.request_id,
  session_id: scan.session_id,
  model: scan.model,
  request: {
    messages_count: scan.user_messages_count,
    tools_count: 0,
    has_system: scan.context_estimate.system_tokens > 0,
    max_tokens: scan.max_tokens,
  },
  response: {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
  },
  cost_usd: 0,
  duration_ms: 0,
});

export const handleScanFromTranscriptRequest = async (
  rawBody: string,
  deps: HandleScanDeps,
): Promise<HandleScanResponse> => {
  let parsed: { session_id?: string; transcript_path?: string };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: json({ error: "invalid_json" }) };
  }

  if (!parsed || typeof parsed !== "object" || !parsed.transcript_path) {
    return { status: 400, body: json({ error: "transcript_path required" }) };
  }

  await waitForTranscriptSettle(parsed.transcript_path, deps.settleOptions);

  const result = scanFromTranscript({
    transcriptPath: parsed.transcript_path,
    globalClaudeMdPath: deps.globalClaudeMdPath,
  });
  if (!result) {
    return { status: 404, body: json({ error: "transcript_not_found_or_empty" }) };
  }

  const { scan, usage } = result;
  if (parsed.session_id) scan.session_id = parsed.session_id;

  const usageEntry = buildHookUsageEntry(scan, usage);

  try {
    deps.writeHookScan(scan, usageEntry);
  } catch (err) {
    return {
      status: 500,
      body: json({ error: "write_failed", message: String((err as Error)?.message ?? err) }),
    };
  }

  return {
    status: 200,
    body: json({ ok: true, request_id: scan.request_id }),
  };
};
