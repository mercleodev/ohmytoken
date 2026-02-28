/** MCP tool classification utilities */

const MCP_KNOWN_TOOLS = new Set([
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
]);

const BUILTIN_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Task',
  'WebFetch', 'WebSearch', 'Skill', 'EnterPlanMode', 'ExitPlanMode',
  'AskUserQuestion', 'NotebookEdit', 'TaskCreate', 'TaskUpdate',
  'TaskGet', 'TaskList', 'EnterWorktree', 'TodoRead', 'TodoWrite',
  'Agent', 'TaskStop', 'EnterWorktree',
]);

/** MCP tool identification: mcp__ prefix or known MCP tool set */
export const isMcpTool = (name: string): boolean => {
  if (name.startsWith('mcp__')) return true;
  return MCP_KNOWN_TOOLS.has(name);
};

/** Extract MCP server name: mcp__figma__action → "figma" */
export const getMcpServerName = (toolName: string): string => {
  if (toolName.startsWith('mcp__')) return toolName.split('__')[1] ?? 'unknown';
  return 'external';
};

/** Check if tool is neither built-in nor MCP */
export const isUnknownTool = (name: string): boolean =>
  !BUILTIN_TOOLS.has(name) && !isMcpTool(name);
