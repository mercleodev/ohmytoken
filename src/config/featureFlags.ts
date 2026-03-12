/**
 * Feature flags for toggling dashboard components.
 *
 * Set a flag to `true` to re-enable the corresponding feature.
 * Code remains compiled and type-checked regardless of flag value.
 */
export const FEATURE_FLAGS = {
  /** MCP Insights card on UsageView + MCP session alerts */
  MCP_INSIGHTS: false,

  /** Output Productivity card on UsageView */
  OUTPUT_PRODUCTIVITY: false,
} as const;
