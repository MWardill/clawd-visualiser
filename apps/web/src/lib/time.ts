/** Local wall-clock `HH:MM:SS` for a timestamp; dashes when it does not parse. */
export function hhmmss(when: string | number | Date): string {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}
