// L2 module tests — conversationEvents compatibility bridge (dsh 0.1.2
// removed the legacy service name; registration moved to uiConversation.events).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installConversationEventsCompat,
  CONVERSATION_EVENTS_SERVICE,
  UI_CONVERSATION_SERVICE,
} from '../../dist/client-conversation-compat.js';

function makeCtx({ services = new Map() } = {}) {
  const injectFibers = [];
  const ctx = {
    get: (name) => services.get(name),
    provide: (name, value) => services.set(name, value),
    inject: (inject, callback) => {
      injectFibers.push({ inject, callback });
      // Mimic cordis: the dependent fiber fires immediately when every
      // injected service already exists, otherwise it stays pending.
      if (inject.every((name) => services.get(name) !== undefined)) callback(ctx);
    },
  };
  return { ctx, services, injectFibers };
}

// Host already provides conversationEvents (dsh ≤ 0.1.1): no bridge.
test('compat does nothing when conversationEvents already exists', () => {
  const existing = { register: () => {} };
  const { ctx, services, injectFibers } = makeCtx();
  services.set(CONVERSATION_EVENTS_SERVICE, existing);
  assert.equal(installConversationEventsCompat(ctx), false);
  assert.equal(injectFibers.length, 0);
  assert.equal(services.get(CONVERSATION_EVENTS_SERVICE), existing);
});

// dsh ≥ 0.1.2: legacy name bridged onto uiConversation.events.
test('compat bridges register onto uiConversation.events', () => {
  const registered = [];
  const { ctx, services } = makeCtx();
  services.set(UI_CONVERSATION_SERVICE, {
    events: { register: (def) => registered.push(def) },
  });
  assert.equal(installConversationEventsCompat(ctx), true);
  const bridge = services.get(CONVERSATION_EVENTS_SERVICE);
  assert.ok(bridge, 'legacy service provided once uiConversation exists');
  bridge.register({ kind: 'approval-status' });
  assert.deepEqual(registered, [{ kind: 'approval-status' }]);
});

// uiConversation arriving later: the bridge provisions only then.
test('compat waits for uiConversation before providing', () => {
  const { ctx, services, injectFibers } = makeCtx();
  assert.equal(installConversationEventsCompat(ctx), true);
  assert.equal(services.get(CONVERSATION_EVENTS_SERVICE), undefined);
  assert.equal(injectFibers.length, 1);
  assert.deepEqual(injectFibers[0].inject, [UI_CONVERSATION_SERVICE]);
  // The service arrives; cordis would now fire the dependent fiber.
  services.set(UI_CONVERSATION_SERVICE, { events: { register: (def) => def } });
  injectFibers[0].callback(ctx);
  assert.ok(services.get(CONVERSATION_EVENTS_SERVICE));
});

// register() against a broken registry face fails loud.
test('compat register throws when the events registry is malformed', () => {
  const { ctx, services } = makeCtx();
  services.set(UI_CONVERSATION_SERVICE, {});
  installConversationEventsCompat(ctx);
  const bridge = services.get(CONVERSATION_EVENTS_SERVICE);
  assert.throws(() => bridge.register({}), /events registry unavailable/);
});

// Reduced contexts (no inject/provide) stay inert.
test('compat stays inert on a reduced context', () => {
  assert.equal(installConversationEventsCompat({}), false);
  assert.equal(installConversationEventsCompat({ get: () => undefined }), false);
});
