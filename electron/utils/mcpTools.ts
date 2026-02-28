/** MCP tool classification utilities (electron-side copy) */

const MCP_KNOWN_TOOLS = new Set([
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
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
