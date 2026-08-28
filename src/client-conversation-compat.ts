// conversationEvents compatibility bridge (browser half).
//
// dsh ≤ 0.1.1 exposed a cordis client service named `conversationEvents`
// whose `register(definition)` accepted a Conversation Node definition.
// dsh 0.1.2 removed that service name: definition registration moved onto
// the `uiConversation` service as `uiConversation.events.register(...)`.
// The definition SHAPE (kind/target/match/start/update/buildViewNode) is
// unchanged between the two lines, so a thin delegating service restores the
// legacy name without touching consumers.
//
// Provision is ordered through `ctx.inject(['uiConversation'], ...)`: the
// delegator only appears once the real registry service exists, so a consumer
// pending on `conversationEvents` never wakes before its register() call can
// succeed. On versions where `conversationEvents` already exists this module
// does nothing; on versions with neither name the inject fiber simply never
// activates (inert).

/** The legacy service name consumers inject. */
export const CONVERSATION_EVENTS_SERVICE = 'conversationEvents';

/** The dsh ≥ 0.1.2 service owning the definition registry. */
export const UI_CONVERSATION_SERVICE = 'uiConversation';

/** Minimal cordis client context surface this bridge touches. */
export interface ConversationCompatContext {
  get?(name: string): unknown;
  provide?(name: string, value: unknown): unknown;
  inject?(inject: string[], callback: (ctx: ConversationCompatContext) => unknown): unknown;
}

/** The registry face the delegator forwards to (`uiConversation.events`). */
interface ConversationEventRegistryLike {
  register(definition: unknown): unknown;
}

/**
 * Provide the legacy `conversationEvents` service when the host lacks it.
 *
 * @param ctx - the client plugin's cordis context.
 * @returns true when the bridge was armed (legacy name absent and inject
 *   available), false when the host already provides the service or the
 *   context cannot order provision.
 */
export function installConversationEventsCompat(ctx: ConversationCompatContext): boolean {
  if (typeof ctx.get !== 'function') return false;
  if (ctx.get(CONVERSATION_EVENTS_SERVICE) !== undefined) return false;
  if (typeof ctx.inject !== 'function' || typeof ctx.provide !== 'function') return false;

  ctx.inject([UI_CONVERSATION_SERVICE], (scope) => {
    scope.provide?.(CONVERSATION_EVENTS_SERVICE, {
      register: (definition: unknown): unknown => {
        const uiConversation = scope.get?.(UI_CONVERSATION_SERVICE) as
          | { events?: ConversationEventRegistryLike }
          | undefined;
        const registry = uiConversation?.events;
        if (registry === undefined || typeof registry.register !== 'function') {
          throw new Error(
            `[dshloader] ${CONVERSATION_EVENTS_SERVICE}: ${UI_CONVERSATION_SERVICE}.events registry unavailable`,
          );
        }
        return registry.register(definition);
      },
    });
  });
  return true;
}
