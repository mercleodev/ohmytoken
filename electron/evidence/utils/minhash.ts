/**
 * MinHash — approximate Jaccard similarity estimation.
 *
 * Reference: Broder (1997) "On the Resemblance and Containment of Documents"
 *            Proc. Compression and Complexity of Sequences, IEEE.
 *
 * Pure implementation: no external dependencies.
 * Uses k independent hash functions via (a*x + b) mod p technique.
 */

const LARGE_PRIME = 4294967311; // Next prime after 2^32

/**
 * Simple 32-bit hash for a string (FNV-1a variant).
 */
const fnv1a = (str: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // force unsigned 32-bit
  }
  return hash;
};

type MinHashSignature = Uint32Array;

/**
 * Generate k pairs of (a, b) coefficients for universal hashing.
 * Deterministic: seeded from k value so results are reproducible.
 */
const generateCoefficients = (k: number): Array<[number, number]> => {
  const coeffs: Array<[number, number]> = [];
  // Simple deterministic generation using linear congruence
  let seed = 42;
  for (let i = 0; i < k; i++) {
    seed = ((seed * 1103515245) + 12345) >>> 0;
    const a = (seed % (LARGE_PRIME - 1)) + 1; // a must be > 0
    seed = ((seed * 1103515245) + 12345) >>> 0;
    const b = seed % LARGE_PRIME;
    coeffs.push([a, b]);
  }
  return coeffs;
};

// Cache coefficients per k value
const coeffCache = new Map<number, Array<[number, number]>>();

const getCoefficients = (k: number): Array<[number, number]> => {
  let cached = coeffCache.get(k);
  if (!cached) {
    cached = generateCoefficients(k);
    coeffCache.set(k, cached);
  }
  return cached;
};

/**
 * Compute MinHash signature for a set of n-grams.
 *
 * @param ngrams - Set of n-gram strings
 * @param k - Number of hash functions (signature length)
 * @returns Uint32Array of k minimum hash values
 */
export const computeMinHash = (ngrams: Set<string>, k = 128): MinHashSignature => {
  const sig = new Uint32Array(k).fill(0xffffffff);
  const coeffs = getCoefficients(k);

  for (const ngram of ngrams) {
    const h = fnv1a(ngram);
    for (let i = 0; i < k; i++) {
      const [a, b] = coeffs[i];
      // Universal hash: ((a * h + b) mod p)
      // Use BigInt for overflow-safe modular arithmetic
      const hashVal = Number((BigInt(a) * BigInt(h) + BigInt(b)) % BigInt(LARGE_PRIME));
      if (hashVal < sig[i]) {
        sig[i] = hashVal;
      }
    }
  }

  return sig;
};

/**
 * Estimate Jaccard similarity from two MinHash signatures.
 *
 * J_hat(A,B) = (1/k) * Σ [h_min_i(A) == h_min_i(B)]
 *
 * @returns Estimated Jaccard similarity in [0, 1]
 */
export const estimateJaccard = (sigA: MinHashSignature, sigB: MinHashSignature): number => {
  if (sigA.length !== sigB.length) {
    throw new Error(`Signature length mismatch: ${sigA.length} vs ${sigB.length}`);
  }
  const k = sigA.length;
  if (k === 0) return 0;

  let matches = 0;
  for (let i = 0; i < k; i++) {
    if (sigA[i] === sigB[i]) matches++;
  }
  return matches / k;
};
