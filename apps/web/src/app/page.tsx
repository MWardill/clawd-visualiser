import { CORE_VERSION } from "@clawd/core";
import { SCENE_VERSION } from "@clawd/scene";
import { ClawdIdle } from "@/components/clawd-idle";

/**
 * Placeholder shell. The panes scene arrives in milestone A2; until then this page proves the
 * deployment pipeline and the workspace links, and sets the frame the scene will sit in.
 */
export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-6 items-center gap-4 bg-card px-3 text-sm text-muted-foreground">
        <span className="font-bold text-clawd">❯ clawd-visualiser</span>
        <span>0 sessions · 0 waiting · 0 subagents</span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-5 py-16">
        <ClawdIdle />
        <p className="max-w-[60ch] text-center text-muted-foreground">
          The city is under construction. Sessions will appear here as Clawds in a pane for each
          repository, working, waiting, idle or asleep.
        </p>
      </main>

      <footer className="flex h-6 items-center justify-between bg-card px-3 text-sm text-muted-foreground">
        <span>core {CORE_VERSION} · scene {SCENE_VERSION}</span>
        <span>local · zero tokens</span>
      </footer>
    </div>
  );
}
