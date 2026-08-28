// Client boot-alias injection (host side).
//
// Why this exists: dshloader's stable client module names
// (`@dsh-plugin/dsh-loader/ui-primitives` and friends, plus the deep-import
// module aliases) resolve through alias factories registered with the
// browser module system. Registering them from dshloader's own client
// `apply` is order-dependent: dsh ≥ 0.1.2 imports every client entry
// CONCURRENTLY (`Promise.all(rows.map(loader.create))` in the web boot
// kernel), so a dependent entry can materialize — and hit
// `require("@dsh-plugin/dsh-loader/ui-primitives")` — before dshloader's
// client apply ever ran, crashing boot with "missed the module table".
//
// The fix moves the alias-factory registration out of cordis activation
// order entirely: the host adapter contributes one inline head script via
// the webserver's `webserver/index-inject` table. That script runs while
// the document parses — before the shell boots the module system and long
// before any entry import — and registers every alias factory with the
// `__ModuleLoader__` facade directly. The facade contract (queue-mode
// `load(registration)` appending to a pending queue, live-mode registering
// immediately) is identical on dsh 0.1.0-rc.x through 0.1.2+, so one script
// covers every version; versions without the facade simply never fire the
// setter and dshloader's apply-time registration stays the fallback.
//
// `installClient` (src/client.ts) reads {@link BOOT_ALIAS_IDS_FLAG} to skip
// re-registering the same factories (the live module system throws on
// duplicate factory ids).

import { BOOT_ALIAS_IDS_FLAG } from './version.js';
import type { CordisContext } from './types.js';

/** The `webserver/index-inject` event name (dsh ≥ 0.1.0-rc.x host webserver). */
const INDEX_INJECT_EVENT = 'webserver/index-inject';

/**
 * Build the inline boot script registering one module-table alias factory
 * per `aliases` entry (stable name → real dsh package name).
 *
 * The script is realm-safe in both facade states: when `__ModuleLoader__`
 * already exists it registers immediately; otherwise it installs a
 * property interceptor that catches the bootstrap queue script's
 * `window.__ModuleLoader__ = {...}` assignment, registers into the fresh
 * facade's pending queue, and restores a plain writable data property so
 * later code (facade `create`, dshloader's apply-time load wrapper) sees a
 * normal global.
 *
 * @param aliases - alias module id → real module id.
 * @returns JavaScript source for an inline classic script.
 */
export function buildBootAliasScript(aliases: Record<string, string>): string {
  const table = JSON.stringify(aliases);
  return `!function(){
var w=window,F=${JSON.stringify(BOOT_ALIAS_IDS_FLAG)};
if(w[F])return;
var A=${table};
var ids=Object.keys(A);
function reg(loader){
for(var i=0;i<ids.length;i++){
var id=ids[i];
loader.load({id:id,factory:function(t,a){return function(require){
var mod=require(t);
if(a.endsWith("context-provenance.ts")||a.endsWith("context-provenance"))return{contextProvenance:mod.contextProvenance};
return mod;
}}(A[id],id)});
}
w[F]=ids;
}
var facade=w.__ModuleLoader__;
if(facade&&typeof facade.load==="function"){reg(facade);return;}
var cur;
Object.defineProperty(w,"__ModuleLoader__",{
configurable:true,enumerable:true,
get:function(){return cur;},
set:function(v){
if(v&&typeof v.load==="function"){
reg(v);
Object.defineProperty(w,"__ModuleLoader__",{configurable:true,enumerable:true,writable:true,value:v});
}else{cur=v;}
}
});
}();
`;
}

/**
 * Contribute the boot-alias script to every rendered index page.
 *
 * The listener pushes one `{ kind: 'script', placement: 'head' }` row onto
 * the injection table the host webserver gathers per index render. On dsh
 * versions whose webserver never emits `webserver/index-inject` the
 * listener simply never fires and only the apply-time path registers
 * aliases — the pre-0.1.2 behaviour that already worked there.
 *
 * @param ctx - host plugin context.
 * @param aliases - alias module id → real module id (both the package and
 *   the deep-import module alias tables).
 * @returns Dispose function removing the listener.
 */
export function installBootAliasInjection(
  ctx: CordisContext,
  aliases: Record<string, string>,
): () => void {
  if (Object.keys(aliases).length === 0 || typeof ctx.on !== 'function') return () => {};
  const row = { kind: 'script', placement: 'head', text: buildBootAliasScript(aliases) };
  const listener = (table: unknown[]): void => {
    table.push(row);
  };
  const dispose = ctx.on(INDEX_INJECT_EVENT, listener);
  if (typeof dispose === 'function') return dispose;
  return () => {
    (ctx as { off?: (event: string, listener: (...args: any[]) => any) => void }).off?.(INDEX_INJECT_EVENT, listener);
  };
}
