import { describe, expect, it } from "vitest";
import { sameOrigin, sessionUrl } from "./navigation";

describe("sameOrigin", () => {
  it("allows the same scheme and host whatever the path or query", () => {
    expect(sameOrigin("http://localhost:3000/", "http://localhost:3000/?source=simulated")).toBe(true);
    expect(sameOrigin("http://localhost:3000/", "http://LOCALHOST:3000/other")).toBe(true);
    expect(sameOrigin("app://clawd/", "app://clawd/settings.html")).toBe(true);
  });

  it("refuses another host, port, scheme, or anything that does not parse", () => {
    expect(sameOrigin("http://localhost:3000/", "http://localhost:3001/")).toBe(false);
    expect(sameOrigin("http://localhost:3000/", "https://localhost:3000/")).toBe(false);
    expect(sameOrigin("http://localhost:3000/", "http://example.com/")).toBe(false);
    expect(sameOrigin("app://clawd/", "app://other/")).toBe(false);
    expect(sameOrigin("http://localhost:3000/", "javascript:alert(1)")).toBe(false);
    expect(sameOrigin("http://localhost:3000/", "not a url")).toBe(false);
    expect(sameOrigin("not a url", "http://localhost:3000/")).toBe(false);
  });
});

describe("sessionUrl", () => {
  it("is the page's URL with the session named in the hash, which the page reads as a link", () => {
    expect(sessionUrl("app://clawd/", "agent-3")).toBe("app://clawd/#session=agent-3");
    expect(sessionUrl("http://localhost:3000/", "agent-12")).toBe("http://localhost:3000/#session=agent-12");
  });

  it("replaces a hash already there, and encodes what a URL cannot carry", () => {
    expect(sessionUrl("app://clawd/#session=agent-1", "agent-2")).toBe("app://clawd/#session=agent-2");
    expect(sessionUrl("app://clawd/", "a b#c")).toBe("app://clawd/#session=a%20b%23c");
  });
});
