export interface DecodedPaymentResponse {
  success?: boolean;
  transaction?: string;
  txHash?: string;
  payer?: string;
  network?: string;
  errorReason?: string;
}

/**
 * Safely decodes standard Base64 or Base64URL-encoded UTF-8 JSON headers.
 * Portable across Cloudflare Workers and Node/Vitest; returns null on malformed input.
 */
export function decodeBase64Json<T = Record<string, unknown>>(
  raw: string | null | undefined
): T | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLength);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const jsonText = new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(jsonText);
    if (parsed !== null && typeof parsed === "object") {
      return parsed as T;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractPaymentResponse(
  headers: Headers
): DecodedPaymentResponse | null {
  const raw =
    headers.get("PAYMENT-RESPONSE") ?? headers.get("X-PAYMENT-RESPONSE");
  return decodeBase64Json<DecodedPaymentResponse>(raw);
}

export function hasPaymentSignatureHeader(headers: Headers): boolean {
  const v2 = headers.get("PAYMENT-SIGNATURE");
  const v1 = headers.get("X-PAYMENT");
  return Boolean((v2 && v2.trim().length > 0) || (v1 && v1.trim().length > 0));
}

export function extractExtensionResponses(headers: Headers): string | null {
  const raw = headers.get("EXTENSION-RESPONSES");
  if (!raw || raw.trim().length === 0) return null;
  return raw.trim();
}
