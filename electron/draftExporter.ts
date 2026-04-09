/**
 * Draft artifact exporter for workflow change recommendations.
 *
 * Writes generated draft artifacts to the user's repository.
 * Handles overwrite policy and path validation.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportResult = {
  success: boolean;
  exportedPath: string;
  overwritten: boolean;
  error?: string;
};

type ExportOptions = {
  suggestedPath: string;
  content: string;
  projectPath: string;
  overwrite?: boolean;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ALLOWED_PREFIXES = [
  'scripts/',
  '.claude/commands/',
  '.claude/checklists/',
  '.claude/rules/profiles/',
  'automation/',
];

function isAllowedPath(relativePath: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function exportWorkflowDraft(options: ExportOptions): ExportResult {
  const { suggestedPath, content, projectPath, overwrite = false } = options;

  if (!isAllowedPath(suggestedPath)) {
    return {
      success: false,
      exportedPath: suggestedPath,
      overwritten: false,
      error: `Export path "${suggestedPath}" is not in an allowed directory. Allowed: ${ALLOWED_PREFIXES.join(', ')}`,
    };
  }

  const absolutePath = path.resolve(projectPath, suggestedPath);

  // Ensure the path is still inside the project (prevent path traversal)
  if (!absolutePath.startsWith(path.resolve(projectPath))) {
    return {
      success: false,
      exportedPath: suggestedPath,
      overwritten: false,
      error: 'Export path escapes project directory.',
    };
  }

  const exists = fs.existsSync(absolutePath);
  if (exists && !overwrite) {
    return {
      success: false,
      exportedPath: suggestedPath,
      overwritten: false,
      error: `File already exists at "${suggestedPath}". Set overwrite=true to replace.`,
    };
  }

  try {
    // Create parent directories
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

    // Write file
    fs.writeFileSync(absolutePath, content, 'utf-8');

    // Make scripts executable
    if (suggestedPath.endsWith('.sh')) {
      fs.chmodSync(absolutePath, 0o755);
    }

    return {
      success: true,
      exportedPath: suggestedPath,
      overwritten: exists,
    };
  } catch (err) {
    return {
      success: false,
      exportedPath: suggestedPath,
      overwritten: false,
      error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export type { ExportResult, ExportOptions };
