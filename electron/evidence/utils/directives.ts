/**
 * Directive pattern extraction for Instruction Compliance signal.
 *
 * Reference:
 *   Zhou et al. (2023) IFEval — arXiv:2311.07911
 *   Qin et al. (2024) InFoBench — arXiv:2401.03601
 *
 * Extracts imperative/directive patterns from system instruction files
 * and checks compliance against the assistant response.
 */

/**
 * A single extracted directive from a system instruction file.
 */
export type Directive = {
  text: string;
  type: 'must' | 'must_not' | 'preference';
};

// Patterns that indicate imperative instructions
const MUST_PATTERNS = [
  /(?:you\s+)?must\s+(.+?)(?:\.|$)/gi,
  /(?:you\s+)?should\s+(?:always\s+)?(.+?)(?:\.|$)/gi,
  /always\s+(.+?)(?:\.|$)/gi,
  /(?:be\s+sure\s+to|make\s+sure\s+to|ensure\s+(?:that\s+)?)\s*(.+?)(?:\.|$)/gi,
  /required?:\s*(.+?)(?:\.|$)/gi,
  /important:\s*(.+?)(?:\.|$)/gi,
  /(?:^|\n)\s*-\s+(.+?(?:\ud560\s*\uac83|\ud558\uc138\uc694|\ud569\ub2c8\ub2e4|\ud574\uc57c))(?:\s|$)/gim, // Korean imperative endings
  /(?:^|\n)\s*-\s+(?:Use|Prefer|Keep|Avoid|Follow|Apply|Define|Break)\s+(.+?)(?:\.|$)/gim,
];

const MUST_NOT_PATTERNS = [
  /(?:you\s+)?must\s+not\s+(.+?)(?:\.|$)/gi,
  /(?:you\s+)?should\s+not\s+(.+?)(?:\.|$)/gi,
  /never\s+(.+?)(?:\.|$)/gi,
  /do\s+not\s+(.+?)(?:\.|$)/gi,
  /don'?t\s+(.+?)(?:\.|$)/gi,
  /avoid\s+(.+?)(?:\.|$)/gi,
  /(?:^|\n)\s*-\s+(.+?(?:\ub9d0\s*\uac83|\ub9c8\uc138\uc694|\uae08\uc9c0))(?:\s|$)/gim, // Korean prohibition endings
];

/**
 * Extract directives from instruction text.
 */
export const extractDirectives = (text: string): Directive[] => {
  const directives: Directive[] = [];
  const seen = new Set<string>();

  const addDirective = (match: string, type: Directive['type']) => {
    const normalized = match.trim().toLowerCase();
    // Deduplicate by normalized text
    if (normalized.length < 5 || seen.has(normalized)) return;
    seen.add(normalized);
    directives.push({ text: match.trim(), type });
  };

  // Extract must-not first (more specific)
  for (const pattern of MUST_NOT_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      addDirective(m[0], 'must_not');
    }
  }

  // Then must/should
  for (const pattern of MUST_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      // Skip if already captured as must_not
      const full = m[0].trim().toLowerCase();
      if (seen.has(full)) continue;
      addDirective(m[0], 'must');
    }
  }

  return directives;
};

/**
 * Check how many directives from a file are complied with in the response.
 *
 * Simple heuristic: for "must" directives, check if key terms appear in response.
 * For "must_not" directives, check absence of forbidden terms.
 *
 * DRFR = complied_count / total_count
 */
export const checkCompliance = (
  directives: Directive[],
  response: string,
): { total: number; complied: number; rate: number } => {
  if (directives.length === 0) {
    return { total: 0, complied: 0, rate: 0 };
  }

  const responseLower = response.toLowerCase();
  let complied = 0;

  for (const d of directives) {
    // Extract key terms (words > 3 chars) from the directive
    const keyTerms = d.text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !/^(must|should|always|never|avoid|don't)$/.test(w));

    if (keyTerms.length === 0) {
      complied++; // No verifiable terms — assume complied
      continue;
    }

    // For "must" directives: at least half of key terms should appear
    // For "must_not" directives: none of the key terms should appear
    const matchCount = keyTerms.filter((t) => responseLower.includes(t)).length;
    const matchRate = matchCount / keyTerms.length;

    if (d.type === 'must_not') {
      if (matchRate < 0.5) complied++;
    } else {
      if (matchRate >= 0.3) complied++;
    }
  }

  return {
    total: directives.length,
    complied,
    rate: directives.length > 0 ? complied / directives.length : 0,
  };
};
