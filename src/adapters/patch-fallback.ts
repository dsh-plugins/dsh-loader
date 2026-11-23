/** Browser-safe selection for numeric patch families; ranges belong to the host registry. */
function parsePatch(value: string): readonly [number, number, number] | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return undefined;
  const parsed = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return parsed.every(Number.isSafeInteger) ? parsed : undefined;
}
function compare(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
export function patchFamily(version: string): string {
  return version.split(/[-+]/, 1)[0];
}
export function nearestLowerPatch<T>(version: string, entries: readonly T[], patchOf: (entry: T) => string): T | undefined {
  const target = parsePatch(patchFamily(version));
  if (!target) return undefined;
  let best: T | undefined;
  let bestPatch: ReturnType<typeof parsePatch>;
  for (const entry of entries) {
    const patch = parsePatch(patchOf(entry));
    if (!patch || patch[0] !== target[0] || compare(patch, target) >= 0) continue;
    if (!bestPatch || compare(patch, bestPatch) >= 0) { best = entry; bestPatch = patch; }
  }
  return best;
}
