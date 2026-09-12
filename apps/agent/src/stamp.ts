/** UTC `YYYYMMDDHHmmss`, for backup and recovery file names. */
export function fileStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}
