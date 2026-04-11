import type { PromptScan, EvidenceReport, SignalResult } from "../../../types";
import type { EvidenceStatus, InjectedEvidenceItem } from "./types";
import { DIRECT_FILE_ACTIONS, INDIRECT_FILE_TOOLS, normalizeText, getFileName } from "./constants";

const getFileStem = (filePath: string): string => {
  const fileName = getFileName(filePath);
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
};

/**
 * Build evidence classification from either:
 * 1. EvidenceReport (scoring engine) — preferred, multi-signal analysis
 * 2. Fallback: simple filename matching (legacy behavior)
 */
export const buildInjectedEvidence = (scan: PromptScan): Record<
  EvidenceStatus,
  InjectedEvidenceItem[]
> => {
  const report = scan.evidence_report;
  if (report && report.files.length > 0) {
    return buildFromEvidenceReport(report, scan);
  }
  return buildLegacyEvidence(scan);
};

const buildFromEvidenceReport = (
  report: EvidenceReport,
  scan: PromptScan,
): Record<EvidenceStatus, InjectedEvidenceItem[]> => {
  const byStatus: Record<EvidenceStatus, InjectedEvidenceItem[]> = {
    confirmed: [],
    likely: [],
    unverified: [],
  };

  for (const fileScore of report.files) {
    const injected = scan.injected_files?.find(
      (f) => f.path === fileScore.filePath,
    );

    const topSignal = fileScore.signals
      .filter((s: SignalResult) => s.score > 0)
      .sort((a: SignalResult, b: SignalResult) => b.score - a.score)[0];

    const reason = topSignal
      ? `${topSignal.detail} (score: ${fileScore.normalizedScore.toFixed(2)})`
      : `Score: ${fileScore.normalizedScore.toFixed(2)}`;

    const item: InjectedEvidenceItem = {
      path: fileScore.filePath,
      category: (injected?.category ?? fileScore.category) as InjectedEvidenceItem["category"],
      estimated_tokens: injected?.estimated_tokens ?? 0,
      status: fileScore.classification,
      reason,
      normalizedScore: fileScore.normalizedScore,
      signals: fileScore.signals,
    };

    byStatus[fileScore.classification as EvidenceStatus].push(item);
  }

  for (const status of ["confirmed", "likely", "unverified"] as const) {
    byStatus[status].sort((a, b) => b.estimated_tokens - a.estimated_tokens);
  }

  return byStatus;
};

const buildLegacyEvidence = (scan: PromptScan): Record<
  EvidenceStatus,
  InjectedEvidenceItem[]
> => {
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

    // Indirect tool check: Bash/exec_command/ToolSearch or any tool with full path
    const indirectToolRef = toolCalls.find((toolCall) => {
      const inputLower = normalizeText(toolCall.input_summary ?? "");
      if (INDIRECT_FILE_TOOLS.has(toolCall.name)) {
        return inputLower.includes(filePathLower) ||
          (fileNameLower.length >= 4 && inputLower.includes(fileNameLower));
      }
      return inputLower.includes(filePathLower);
    });

    if (indirectToolRef) {
      return {
        ...file,
        status: "likely" as const,
        reason: `${indirectToolRef.name} input contains reference to this file`,
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

    // File stem check (e.g. "EvidenceGroup" from "EvidenceGroup.tsx")
    const fileStem = normalizeText(getFileStem(file.path));
    const mentionByStem = fileStem.length >= 6 && (
      responseLower.includes(fileStem) ||
      userPromptLower.includes(fileStem)
    );

    if (mentionByResponse || mentionByTool || mentionByPrompt || mentionByStem) {
      const reason = mentionByResponse
        ? "Assistant response mentions this file"
        : mentionByTool
          ? `${mentionByTool.name} input references this file`
          : mentionByPrompt
            ? "User prompt references this file"
            : `Response references identifier "${getFileStem(file.path)}"`;
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
