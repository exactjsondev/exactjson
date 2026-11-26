export type NegotiatedFormat = "html" | "markdown" | "json";

/**
 * Negotiates response format from an HTTP Accept header among text/markdown,
 * text/html, and application/json.
 * Defaults to "json" for missing Accept, wildcard (*\/*), application/json,
 * and ties between text/html and application/json so CLI tools, SDKs, and
 * x402 discovery crawlers always receive machine-readable JSON.
 */
export function negotiateContentType(acceptHeader: string | undefined): NegotiatedFormat {
  if (!acceptHeader || !acceptHeader.trim()) {
    return "json";
  }

  let htmlQuality = -1;
  let markdownQuality = -1;
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
    } else if (mediaType === "text/markdown" || mediaType === "text/x-markdown") {
      markdownQuality = Math.max(markdownQuality, q);
    } else if (mediaType === "application/json") {
      jsonQuality = Math.max(jsonQuality, q);
    }
  }

  if (markdownQuality > 0 && markdownQuality >= htmlQuality && markdownQuality >= jsonQuality) {
    return "markdown";
  }
  if (htmlQuality > 0 && htmlQuality > jsonQuality) {
    return "html";
  }
  return "json";
}

/**
 * Determines whether an HTTP Accept header explicitly prefers text/html over
 * text/markdown and application/json.
 */
export function prefersHtml(acceptHeader: string | undefined): boolean {
  return negotiateContentType(acceptHeader) === "html";
}
