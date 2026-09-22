import { describe, expect, it } from "vitest";
import { sameOrigin } from "./navigation";

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
