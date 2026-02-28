export type RequestMeta = {
  model: string;
  max_tokens: number;
  messages_count: number;
  tools_count: number;
  has_system: boolean;
  stream: boolean;
};

export type SseEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'ping'
  | 'error';

export type SseEvent = {
  type: SseEventType;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  raw: string;
};

export type PendingUsage = {
  request_id: string;
  session_id: string;
  model: string;
  request_meta: RequestMeta;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  started_at: string;
};

export type UsageLogEntry = {
  timestamp: string;
  request_id: string;
  session_id: string;
  model: string;
  request: {
    messages_count: number;
    tools_count: number;
    has_system: boolean;
    max_tokens: number;
  };
  response: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  cost_usd: number;
  duration_ms: number;
};

export type ModelPricing = {
  input_per_1m: number;
  output_per_1m: number;
  cache_create_per_1m: number;
  cache_read_per_1m: number;
};

export type ProxyStatus = {
  running: boolean;
  port: number | null;
  upstream: string | null;
  requests_total: number;
  errors_total: number;
};

// --- PromptScan (CT Scan) types ---

export type InjectedFile = {
  path: string;
  category: 'global' | 'project' | 'rules' | 'memory' | 'skill';
  estimated_tokens: number;
};

export type ToolCall = {
  index: number;
  name: string;
  input_summary: string;
  timestamp?: string;
};

export type AgentCall = {
  index: number;
  subagent_type: string;
  description: string;
};

export type PromptScan = {
  request_id: string;
  session_id: string;
  timestamp: string;

  user_prompt: string;
  user_prompt_tokens: number;
  assistant_response?: string;

  injected_files: InjectedFile[];
  total_injected_tokens: number;

  tool_calls: ToolCall[];
  tool_summary: Record<string, number>;

  agent_calls: AgentCall[];

  context_estimate: {
    system_tokens: number;
    messages_tokens: number;
    messages_tokens_breakdown?: {
      user_text_tokens: number;
      assistant_tokens: number;
      tool_result_tokens: number;
    };
    tools_definition_tokens: number;
    total_tokens: number;
  };

  model: string;
  max_tokens: number;
  conversation_turns: number;
  user_messages_count: number;
  assistant_messages_count: number;
  tool_result_count: number;

  /** Provider identifier (e.g. "claude", "codex", "gemini"). Omitted = "claude". */
  provider?: string;

  /** Evidence scoring report (attached asynchronously after scan completion) */
  evidence_report?: import('../evidence/types').EvidenceReport;
};

export type ScanStats = {
  cost_by_time: Array<{ timestamp: string; model: string; cost_usd: number }>;
  tool_frequency: Record<string, number>;
  injected_file_tokens: Array<{ path: string; total_tokens: number; percentage: number }>;
  cache_hit_rate: Array<{ timestamp: string; hit_rate: number }>;
  cost_by_period: Array<{ period: string; cost_usd: number; request_count: number }>;
  summary: {
    total_requests: number;
    total_cost_usd: number;
    avg_context_tokens: number;
    most_used_tool: string;
    cache_hit_rate: number;
  };
};
