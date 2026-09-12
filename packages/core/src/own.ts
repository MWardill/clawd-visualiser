/**
 * Own-property lookup on a plain record. Sessions, panes, aliases and the tool table are records
 * keyed by ids that come off the wire, so an id such as "constructor" must never be an inherited hit.
 */
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
