/** Tracks resources even when async setup finishes after disposal. */
export class ResourceScope {
  private closed = false;
  private resources = new Set<() => void>();
  get disposed(): boolean { return this.closed; }
  add(dispose: () => void): () => void {
    let active = true;
    const release = () => { if (!active) return; active = false; this.resources.delete(release); dispose(); };
    if (this.closed) release(); else this.resources.add(release);
    return release;
  }
  dispose = (): void => {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const release of [...this.resources].reverse()) { try { release(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Resource cleanup failed');
  };
}
export interface ResourceOwner { effect(fn: () => (() => void) | void): unknown }
export function ownedScope(owner?: ResourceOwner): ResourceScope {
  const scope = new ResourceScope();
  owner?.effect?.(() => scope.dispose);
  return scope;
}
/** Registration tokens make out-of-order removal independent of value equality. */
export class AliasTable {
  readonly values = new Map<string, string>();
  private registrations = new Map<symbol, Record<string, string>>();
  register(entries: Record<string, string>): () => void {
    const token = Symbol();
    this.registrations.set(token, { ...entries });
    this.refresh();
    return () => { if (this.registrations.delete(token)) this.refresh(); };
  }
  private refresh(): void {
    this.values.clear();
    for (const entries of this.registrations.values()) for (const [key, value] of Object.entries(entries)) this.values.set(key, value);
  }
}
