import { describe, expect, it } from "vitest";
import { PALETTE } from "./engine";
import { fakeContext } from "./testing/fake-context";
import { STATE_COLOURS, TITLE_MAX, drawText, mmss, nameplate, paneTitle } from "./text";

const T0 = 1_700_000_000_000;

describe("text", () => {
  it("formats minutes and seconds, clamping negatives to zero", () => {
    expect(mmss(0)).toBe("00:00");
    expect(mmss(61_000)).toBe("01:01");
    expect(mmss(3_599_999)).toBe("59:59");
    expect(mmss(-5)).toBe("00:00");
  });

  it("builds a nameplate: lower-case name, subagent count, state with activity and time, state colour", () => {
    const np = nameplate({ label: "Otter", state: "working", activity: "edit", subagents: 2, since: T0 }, T0 + 12_000);
    expect(np).toEqual({ name: "otter", subs: " ×2", status: "working·edit 00:12", colour: PALETTE.state.green });
    const idle = nameplate({ label: "Heron", state: "idle", activity: null, subagents: 0, since: T0 }, T0);
    expect(idle).toEqual({ name: "heron", subs: "", status: "idle 00:00", colour: STATE_COLOURS.idle });
    expect(nameplate({ label: "Lynx", state: "waiting", activity: "edit", subagents: 0, since: T0 }, T0).status).toBe("waiting 00:00");
  });

  it("titles a pane with a dash and the lower-case label", () => {
    expect(paneTitle("Oak")).toBe("─ oak");
    expect(paneTitle("visualiser-web")).toBe("─ visualiser-web");
  });

  it("cuts a title longer than the pane can hold with an ellipsis", () => {
    expect(paneTitle("a".repeat(TITLE_MAX))).toBe(`─ ${"a".repeat(TITLE_MAX)}`);
    expect(paneTitle("abcdefghijklmnopqrstuvwxyz")).toBe("─ abcdefghijklmnopqrstuvw…");
    expect(TITLE_MAX).toBe(24);
  });

  it("draws text at a cell boundary with the requested style", () => {
    const { ctx, texts } = fakeContext();
    drawText(ctx, 6, "hi", 3, 4, "#abc", { size: 11, font: "Mono", bold: true, align: "center" });
    expect(texts[0]).toMatchObject({ text: "hi", x: 18, y: 24, col: "#abc", font: "bold 11px Mono", align: "center" });
  });
});
