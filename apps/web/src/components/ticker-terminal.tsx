"use client";

// The redacted ticker in xterm.js. Loaded on demand by the sheet through next/dynamic, so xterm
// is not in the initial bundle. Writes the backfill first, then streamed lines, in order.
import type { TickerEvent } from "@clawd/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { formatTicker } from "@/lib/ticker/format";

/** The app's tokens as an xterm theme; ANSI red is Clawd orange so the spawn category matches the scene. */
const THEME = {
  background: "#0a0b10",
  foreground: "#c9ccd6",
  cursor: "#0a0b10",
  cursorAccent: "#0a0b10",
  selectionBackground: "#1e2130",
  black: "#0a0b10",
  red: "#cd6e58",
  green: "#8fd18a",
  yellow: "#f2c35b",
  blue: "#7fa6f0",
  magenta: "#b48cf0",
  cyan: "#7fa6f0",
  white: "#c9ccd6",
  brightBlack: "#5d6274",
  brightRed: "#cd6e58",
  brightGreen: "#8fd18a",
  brightYellow: "#f2c35b",
  brightBlue: "#7fa6f0",
  brightMagenta: "#f06090",
  brightCyan: "#7fa6f0",
  brightWhite: "#d9dbe6",
};

type Props = {
  alias: string;
  subscribe: (alias: string, fn: (e: TickerEvent) => void) => () => void;
  backfill: (alias: string) => Promise<TickerEvent[]>;
};

export default function TickerTerminal({ alias, subscribe, backfill }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const term = new Terminal({
      theme: THEME,
      fontFamily: getComputedStyle(el).fontFamily,
      fontSize: 12,
      lineHeight: 1.2,
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "underline",
      cursorInactiveStyle: "none",
      convertEol: true,
      scrollback: 2000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    let ready = false;
    let cancelled = false;
    const queue: TickerEvent[] = [];
    const write = (e: TickerEvent): void => term.writeln(formatTicker(e));
    const unsubscribe = subscribe(alias, (e) => {
      if (ready) write(e);
      else queue.push(e);
    });
    // A feed that cannot backfill still streams: treat a rejection as an empty history.
    void backfill(alias).catch((): TickerEvent[] => []).then((lines) => {
      if (cancelled) return;
      for (const line of lines) write(line);
      for (const line of queue) write(line);
      queue.length = 0;
      ready = true;
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(el);

    return () => {
      cancelled = true;
      unsubscribe();
      observer.disconnect();
      term.dispose();
    };
  }, [alias, subscribe, backfill]);

  return <div ref={ref} className="h-full w-full" />;
}
