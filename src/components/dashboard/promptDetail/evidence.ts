import type { PromptScan } from "../../../types";
import { DIRECT_FILE_ACTIONS } from "./constants";
import type { EvidenceStatus, InjectedEvidenceItem } from "./constants";

export const normalizeText = (value: string): string =>
  value.trim().toLowerCase();

export const getFileName = (pathValue: string): string =>
  pathValue.split("/").filter(Boolean).pop() ?? pathValue;

export const getLanguage = (filePath: string): string => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    sh: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    xml: "xml",
    sql: "sql",
    rb: "ruby",
    swift: "swift",
  };
  return map[ext] || "text";
};

export const buildInjectedEvidence = (
  scan: PromptScan,
): Record<EvidenceStatus, InjectedEvidenceItem[]> => {
  const injectedFiles = scan.injected_files ?? [];
  const toolCalls = scan.tool_calls ?? [];
  const userPromptLower = normalizeText(scan.user_prompt ?? "");
  const responseLower = normalizeText(scan.assistant_response ?? "");

  const classified: InjectedEvidenceItem[] = injectedFiles.map((file) => {
    const filePathLower = normalizeText(file.path);
    const fileName = getFileName(file.path);
    const fileNameLower = normalizeText(fileName);

    const directAction = toolCalls.find((toolCall) => {
      if (!DIRECT_FILE_ACTIONS.has(toolCall.name)) return false;
      const inputLower = normalizeText(toolCall.input_summary ?? "");
      return (
        inputLower.includes(filePathLower) ||
        (fileNameLower.length >= 4 && inputLower.includes(fileNameLower))
      );
    });

    if (directAction) {
      return {
        ...file,
        status: "confirmed" as const,
        reason: `${directAction.name} referenced this file directly`,
      };
    }

    const mentionByTool = toolCalls.find((toolCall) => {
      const inputLower = normalizeText(toolCall.input_summary ?? "");
      return fileNameLower.length >= 4 && inputLower.includes(fileNameLower);
    });
    const mentionByResponse =
      fileNameLower.length >= 4 && responseLower.includes(fileNameLower);
    const mentionByPrompt =
      fileNameLower.length >= 4 && userPromptLower.includes(fileNameLower);

    if (mentionByResponse || mentionByTool || mentionByPrompt) {
      const reason = mentionByResponse
        ? "Assistant response mentions this file"
        : mentionByTool
          ? `${mentionByTool.name} input references this file`
          : "User prompt references this file";
      return {
        ...file,
        status: "likely" as const,
        reason,
      };
    }

    return {
      ...file,
      status: "unverified" as const,
      reason: "No direct reference found in actions or response",
    };
  });

  const byStatus: Record<EvidenceStatus, InjectedEvidenceItem[]> = {
    confirmed: [],
    likely: [],
    unverified: [],
  };

  for (const item of classified.sort(
    (a, b) => b.estimated_tokens - a.estimated_tokens,
  )) {
    byStatus[item.status].push(item);
  }

  return byStatus;
};
