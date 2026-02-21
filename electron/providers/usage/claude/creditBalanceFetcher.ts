// Anthropic API credit balance fetcher (for Prepaid accounts)

import { readClaudeApiKey } from "../credentialReader";
import { CreditBalance } from "../types";

const CREDIT_BALANCE_ENDPOINT =
  "https://api.anthropic.com/v1/organization/credit_balance";
const ANTHROPIC_VERSION = "2023-06-01";

type CreditGrant = {
  id?: string;
  amount_granted_cents?: number;
  amount_remaining_cents?: number;
  amount_used_cents?: number;
  expires_at?: string;
};

type CreditBalanceResponse = {
  // Possible response formats
  credit_balance_cents?: number;
  available_balance_cents?: number;
  total_granted_cents?: number;
  total_used_cents?: number;
  grants?: CreditGrant[];
  // Alternative format (USD unit)
  credit_balance?: number;
  available_balance?: number;
  balance?: number;
};

const centsToUSD = (cents: number): number => cents / 100;

export const fetchCreditBalance = async (): Promise<CreditBalance | null> => {
  const apiKey = readClaudeApiKey();
  if (!apiKey) {
    console.log("[CreditBalance] No API key found");
    return null;
  }

  try {
    const res = await fetch(CREDIT_BALANCE_ENDPOINT, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
    });

    if (!res.ok) {
      console.log(`[CreditBalance] API returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as CreditBalanceResponse;

    // Response in cents
    if (
      data.credit_balance_cents !== undefined ||
      data.available_balance_cents !== undefined
    ) {
      const balance =
        data.available_balance_cents ?? data.credit_balance_cents ?? 0;
      const granted = data.total_granted_cents;
      const used = data.total_used_cents;
      const firstGrant = data.grants?.[0];

      return {
        balanceUSD: centsToUSD(balance),
        grantedUSD: granted !== undefined ? centsToUSD(granted) : undefined,
        usedUSD: used !== undefined ? centsToUSD(used) : undefined,
        expiresAt: firstGrant?.expires_at,
      };
    }

    // Response in USD
    if (
      data.credit_balance !== undefined ||
      data.available_balance !== undefined ||
      data.balance !== undefined
    ) {
      const balance =
        data.available_balance ?? data.credit_balance ?? data.balance ?? 0;

      return {
        balanceUSD: balance,
      };
    }

    // When only grants array is present
    if (data.grants && data.grants.length > 0) {
      let totalRemaining = 0;
      let totalGranted = 0;
      let totalUsed = 0;
      let latestExpiry: string | undefined;

      for (const grant of data.grants) {
        totalRemaining += grant.amount_remaining_cents ?? 0;
        totalGranted += grant.amount_granted_cents ?? 0;
        totalUsed += grant.amount_used_cents ?? 0;
        if (grant.expires_at) {
          if (!latestExpiry || grant.expires_at > latestExpiry) {
            latestExpiry = grant.expires_at;
          }
        }
      }

      return {
        balanceUSD: centsToUSD(totalRemaining),
        grantedUSD: centsToUSD(totalGranted),
        usedUSD: centsToUSD(totalUsed),
        expiresAt: latestExpiry,
      };
    }

    console.log("[CreditBalance] Unrecognized response format");
    return null;
  } catch (err) {
    console.error("[CreditBalance] Fetch error:", err);
    return null;
  }
};
