/**
 * Signal 4: Tool Reference
 *
 * Checks if tools directly referenced this file (Read/Write/Edit)
 * or indirectly mentioned it (filename appears in tool input/output).
 *
 * Papers:
 *   Schick et al. (2023) "Toolformer" arXiv:2302.04761
 *   Qin et al. (2023) "ToolLLM" arXiv:2307.16789
 */

import type { SignalPlugin } from './types';

const DIRECT_FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep']);
const INDIRECT_FILE_TOOLS = new Set(['Bash', 'exec_command', 'ToolSearch']);

export const toolReferenceSignal: SignalPlugin = {
  id: 'tool-reference',
  name: 'Tool Reference',
  version: '1.0.0',
  papers: [
    {
      authors: 'Schick et al.',
      title: 'Toolformer: Language Models Can Teach Themselves to Use Tools',
      venue: 'NeurIPS',
      year: 2023,
      identifier: 'arXiv:2302.04761',
    },
    {
      authors: 'Qin et al.',
      title: 'ToolLLM: Facilitating Large Language Models to Master 16000+ Real-world APIs',
      venue: 'ICLR',
      year: 2024,
      identifier: 'arXiv:2307.16789',
    },
  ],
  paramDefs: [
    { key: 'direct_score', description: 'Score when tool directly references the file', type: 'number', default: 15, min: 0, max: 30 },
    { key: 'indirect_scale', description: 'Scale factor for indirect mention', type: 'number', default: 0.53, min: 0, max: 1 },
    { key: 'max_score', description: 'Maximum score for this signal', type: 'number', default: 15, min: 0, max: 30 },
  ],
  maxScore: 15,

  compute(input, params) {
    const directScore = Number(params.direct_score ?? 15);
    const indirectScale = Number(params.indirect_scale ?? 0.53);
    const maxScore = Number(params.max_score ?? 15);

    const filePath = input.file.path;
    const fileName = filePath.split('/').pop() ?? filePath;
    const toolCalls = input.scan.tool_calls;

    // Check for direct file tool references
    let hasDirect = false;
    let hasIndirect = false;

    for (const tc of toolCalls) {
      const summary = tc.input_summary.toLowerCase();
      const filePathLower = filePath.toLowerCase();
      const fileNameLower = fileName.toLowerCase();

      if (DIRECT_FILE_TOOLS.has(tc.name)) {
        // Direct: tool explicitly targets this file
        if (summary.includes(filePathLower) || summary.includes(fileNameLower)) {
          hasDirect = true;
          break;
        }
      }

      // Indirect: Bash/exec_command/ToolSearch with file path in input
      if (INDIRECT_FILE_TOOLS.has(tc.name)) {
        if (summary.includes(filePathLower) || (fileNameLower.length >= 4 && summary.includes(fileNameLower))) {
          hasIndirect = true;
        }
      }

      // Indirect: filename mentioned in any tool's input
      if (fileNameLower.length >= 4 && summary.includes(fileNameLower)) {
        hasIndirect = true;
      }
    }

    // Content identifier check: exported function/class names from file content
    if (!hasDirect && !hasIndirect && input.file.content) {
      const EXPORT_PATTERN = /export\s+(?:function|const|class|type|interface|enum|default\s+(?:function|class))\s+(\w+)/g;
      const responseLower = (input.scan.assistant_response ?? '').toLowerCase();
      let match: RegExpExecArray | null;
      while ((match = EXPORT_PATTERN.exec(input.file.content)) !== null) {
        if (match[1].length >= 6 && responseLower.includes(match[1].toLowerCase())) {
          hasIndirect = true;
          break;
        }
      }
    }

    // Also check user prompt and assistant response for indirect mentions
    if (!hasDirect && !hasIndirect) {
      const fileNameLower = fileName.toLowerCase();
      if (fileNameLower.length >= 4) {
        const userPrompt = (input.scan.user_prompt ?? '').toLowerCase();
        const assistantResponse = (input.scan.assistant_response ?? '').toLowerCase();
        if (userPrompt.includes(fileNameLower) || assistantResponse.includes(fileNameLower)) {
          hasIndirect = true;
        }
      }
    }

    let score: number;
    let detail: string;

    if (hasDirect) {
      score = Math.min(directScore, maxScore);
      detail = `Direct tool reference to "${fileName}" → ${score}/${maxScore}`;
    } else if (hasIndirect) {
      score = Math.min(indirectScale * maxScore, maxScore);
      detail = `Indirect mention of "${fileName}" → ${score.toFixed(1)}/${maxScore}`;
    } else {
      score = 0;
      detail = `No tool reference to "${fileName}"`;
    }

    return {
      signalId: this.id,
      score: Math.round(score * 100) / 100,
      maxScore,
      confidence: hasDirect ? 1 : hasIndirect ? indirectScale : 0,
      detail,
    };
  },
};
