/**
 * Determines whether an HTTP Accept header explicitly prefers text/html over application/json.
 * Defaults to false for missing Accept, wildcard (*\/*), or application/json so CLI tools,
 * SDKs, and x402 discovery crawlers always receive machine-readable JSON.
 */
export function prefersHtml(acceptHeader: string | undefined): boolean {
  if (!acceptHeader || !acceptHeader.trim()) {
    return false;
  }

  let htmlQuality = -1;
  let jsonQuality = -1;

  for (const rawRange of acceptHeader.split(",")) {
    const parts = rawRange
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) continue;

    const firstPart = parts[0];
    if (!firstPart) continue;

    const mediaType = firstPart.toLowerCase();
    let q = 1;
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const param = part.toLowerCase();
      if (param.startsWith("q=")) {
        const parsed = Number.parseFloat(param.slice(2));
        if (Number.isFinite(parsed)) {
          q = Math.max(0, Math.min(1, parsed));
        }
      }
    }

    if (mediaType === "text/html") {
      htmlQuality = Math.max(htmlQuality, q);
    } else if (mediaType === "application/json") {
      jsonQuality = Math.max(jsonQuality, q);
    }
  }

  if (htmlQuality <= 0) {
    return false;
  }
  if (jsonQuality > htmlQuality) {
    return false;
  }
  if (jsonQuality === htmlQuality && jsonQuality > 0) {
    return false;
  }
  return true;
}
