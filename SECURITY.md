# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ExactJSON (`exactjson.com`, the Cloudflare Worker API, or the `exactjson-mcp` npm package), please report it privately to **[hello@exactjson.com](mailto:hello@exactjson.com)**.

- **Do not** open public GitHub issues for unpatched vulnerabilities.
- **Never** send private keys, seed phrases, or signing secrets in emails or issue reports.
- Include reproduction steps, affected endpoint or file paths, and observed vs. expected behavior so we can triage quickly.

## Security Architecture

- **Non-custodial client-side signing:** Both direct x402 HTTP callers and local `exactjson-mcp` stdio users sign EIP-3009 USDC authorizations strictly client-side with client-enforced spend caps (`MAX_PAYMENT_USD`). ExactJSON never receives or custodies user private keys.
- **Pay-Only-On-Success settlement:** Only `HTTP 200` responses settle x402 payments. Unpaid probes (`402`), invalid inputs (`400`/`404`/`405`), fail-closed upstream failures (`502`), and operator pauses (`503`) never settle.
- **Fail-closed safety checks:** EVM token safety (`/v1/evm/safety`) combines dual engines (GoPlus + Honeypot.is) and Solana safety (`/v1/solana/safety`) relies on RugCheck; if primary security engines fail or return an error payload, ExactJSON fails closed with `HTTP 502` instead of reporting a token as safe.
- **Hardened web headers:** Public HTML pages enforce `Content-Security-Policy: default-src 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and zero third-party tracking scripts or cookies.
