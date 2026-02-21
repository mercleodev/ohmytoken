/**
 * Signal 2: Text Overlap
 *
 * MinHash-based approximate Jaccard similarity between file content
 * and the assistant response.
 *
 * J_hat(A,B) = (1/k) · Σ[h_min_i(A) == h_min_i(B)] → score = J_hat × max_score
 *
 * Paper:
 *   Broder (1997) "On the Resemblance and Containment of Documents"
 *   Proc. Compression and Complexity of Sequences, IEEE.
 */

import type { SignalPlugin } from './types';
import { extractNgrams } from '../utils/ngram';
import { computeMinHash, estimateJaccard } from '../utils/minhash';

export const textOverlapSignal: SignalPlugin = {
  id: 'text-overlap',
  name: 'Text Overlap',
  version: '1.0.0',
  papers: [
    {
      authors: 'Broder',
      title: 'On the Resemblance and Containment of Documents',
      venue: 'Proc. Compression and Complexity of Sequences, IEEE',
      year: 1997,
    },
  ],
  paramDefs: [
    { key: 'k', description: 'Number of MinHash functions', type: 'number', default: 128, min: 16, max: 512 },
    { key: 'ngram_size', description: 'N-gram character size', type: 'number', default: 3, min: 2, max: 5 },
    { key: 'max_score', description: 'Maximum score for this signal', type: 'number', default: 25, min: 0, max: 50 },
  ],
  maxScore: 25,

  compute(input, params) {
    const k = Number(params.k ?? 128);
    const ngramSize = Number(params.ngram_size ?? 3);
    const maxScore = Number(params.max_score ?? 25);

    const fileContent = input.file.content ?? '';
    const response = input.scan.assistant_response ?? '';

    if (!fileContent || !response) {
      return {
        signalId: this.id,
        score: 0,
        maxScore,
        confidence: 0,
        detail: fileContent ? 'No assistant response' : 'No file content available',
      };
    }

    const fileNgrams = extractNgrams(fileContent, ngramSize);
    const responseNgrams = extractNgrams(response, ngramSize);

    if (fileNgrams.size === 0 || responseNgrams.size === 0) {
      return {
        signalId: this.id,
        score: 0,
        maxScore,
        confidence: 0,
        detail: 'Insufficient text for n-gram extraction',
      };
    }

    const fileSig = computeMinHash(fileNgrams, k);
    const responseSig = computeMinHash(responseNgrams, k);
    const jaccard = estimateJaccard(fileSig, responseSig);

    const score = Math.min(jaccard * maxScore, maxScore);

    return {
      signalId: this.id,
      score: Math.round(score * 100) / 100,
      maxScore,
      confidence: jaccard,
      detail: `Jaccard(file, response) ≈ ${(jaccard * 100).toFixed(1)}% → ${score.toFixed(1)}/${maxScore}`,
    };
  },
};
