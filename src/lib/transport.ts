import type { RequestTransport } from "../types";

const internalMcpRequests = new WeakSet<Request>();

/**
 * Tags an internally dispatched Request created by POST /mcp so telemetryMiddleware
 * records transport = "mcp" without trusting any client-supplied HTTP header.
 */
export function markMcpInternalRequest(req: Request): Request {
  internalMcpRequests.add(req);
  return req;
}

export function detectRequestTransport(req: Request): RequestTransport {
  return internalMcpRequests.has(req) ? "mcp" : "http";
}
