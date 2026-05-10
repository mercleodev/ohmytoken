import { describe, it, expect } from "vitest";
import { isMessagesUrl, sanitizeForwardHeaders } from "../server";

describe("isMessagesUrl", () => {
  it("matches the bare /v1/messages path", () => {
    expect(isMessagesUrl("/v1/messages")).toBe(true);
  });

  it("matches /v1/messages with the ?beta=true query string sent by Claude Code 2.x", () => {
    expect(isMessagesUrl("/v1/messages?beta=true")).toBe(true);
  });

  it("matches /v1/messages with any future query string", () => {
    expect(isMessagesUrl("/v1/messages?foo=1&bar=2")).toBe(true);
  });

  it("does not match other endpoints", () => {
    expect(isMessagesUrl("/v1/models")).toBe(false);
    expect(isMessagesUrl("/v1/messages/extra")).toBe(false);
    expect(isMessagesUrl("/")).toBe(false);
  });

  it("does not match when the url is undefined", () => {
    expect(isMessagesUrl(undefined)).toBe(false);
  });

  it("does not match a trailing-slash variant — Anthropic rejects `/v1/messages/`, so it must fall through", () => {
    expect(isMessagesUrl("/v1/messages/")).toBe(false);
  });
});

describe("sanitizeForwardHeaders", () => {
  it("forces accept-encoding=identity for messages traffic even when the inbound request advertised gzip", () => {
    const out = sanitizeForwardHeaders(
      { "accept-encoding": "gzip, deflate, br" },
      "api.anthropic.com",
      0,
      true,
    );
    expect(out["accept-encoding"]).toBe("identity");
  });

  it("forces accept-encoding=identity for messages traffic when the inbound request did not advertise any encoding", () => {
    const out = sanitizeForwardHeaders({}, "api.anthropic.com", 0, true);
    expect(out["accept-encoding"]).toBe("identity");
  });

  it("preserves the inbound accept-encoding for non-messages traffic so other endpoints keep gzip negotiation", () => {
    const out = sanitizeForwardHeaders(
      { "accept-encoding": "gzip, deflate, br" },
      "api.anthropic.com",
      0,
      false,
    );
    expect(out["accept-encoding"]).toBe("gzip, deflate, br");
  });

  it("rewrites the host header to the upstream host", () => {
    const out = sanitizeForwardHeaders(
      { host: "127.0.0.1:8780" },
      "api.anthropic.com",
      0,
      true,
    );
    expect(out.host).toBe("api.anthropic.com");
  });

  it("drops transfer-encoding so the upstream does not see chunked semantics from the client", () => {
    const out = sanitizeForwardHeaders(
      { "transfer-encoding": "chunked" },
      "api.anthropic.com",
      0,
      true,
    );
    expect(out["transfer-encoding"]).toBeUndefined();
  });

  it("sets content-length to the byte length of the forwarded body", () => {
    const body = "hello-body";
    const out = sanitizeForwardHeaders(
      {},
      "api.anthropic.com",
      Buffer.byteLength(body),
      true,
    );
    expect(out["content-length"]).toBe(String(Buffer.byteLength(body)));
  });

  it("does not mutate the inbound headers object", () => {
    const inbound = {
      "accept-encoding": "gzip, deflate, br",
      "transfer-encoding": "chunked",
      host: "127.0.0.1:8780",
    };
    const snapshot = { ...inbound };
    sanitizeForwardHeaders(inbound, "api.anthropic.com", 99, true);
    expect(inbound).toEqual(snapshot);
  });
});
