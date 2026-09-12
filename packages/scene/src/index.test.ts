import { describe, expect, it } from "vitest";
import { SCENE_VERSION } from "./index";

describe("@clawd/scene", () => {
  it("exports a version", () => {
    expect(SCENE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
