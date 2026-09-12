// @clawd/scene
// The canvas renderer. The engine (engine.ts) is the clawd-animation skill's pixel engine as a
// module; scenes are written around it. Framework-free: given a canvas, a scene draws frames.

export * from "./engine";
export { mountIdleClawd, type IdleClawdOptions } from "./idle";
export { mountPanesScene, type PanesScene, type PanesSceneOptions } from "./panes";
export { CELL } from "./layout";
export { mmss } from "./text";

export const SCENE_VERSION = "0.1.0";
