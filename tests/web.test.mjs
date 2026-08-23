// L1 unit tests for the dshloader WEB facade (src/services/web.ts → dist/services/web.js).
//
// The facade's whole job is translating a small, stable surface into dsh's
// `webServer.register({ kind, ... })` call shapes. These tests pin each
// translation, because a wrong `kind` fails at runtime in a way that is hard to
// trace back from a route simply never firing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWebAPI, DshLoaderWebError } from '../dist/services/web.js';
import { makeMockCtx, makeMockWebServer } from './helpers/mock.mjs';

/** A ctx whose `webServer` is the mock. `makeMockCtx` takes a Map and returns a wrapper. */
function ctxWithWeb(serviceName = 'webServer') {
  const { webServer, registrations } = makeMockWebServer();
  const { ctx } = makeMockCtx({ services: new Map([[serviceName, webServer]]) });
  return { ctx, registrations };
}

/** A ctx with no web service at all. */
function ctxWithoutWeb() {
  return makeMockCtx({ services: new Map() }).ctx;
}

const handler = () => {};

test('register mounts a prefix route', () => {
  const { ctx, registrations } = ctxWithWeb();
  createWebAPI({ ctx }).register('/api/mine', handler);
  assert.deepEqual(registrations[0], { kind: 'prefix', path: '/api/mine', handler });
});

test('exact mounts an any-method exact route', () => {
  const { ctx, registrations } = ctxWithWeb();
  createWebAPI({ ctx }).exact('/_dsh/plugin/settings', handler);
  assert.deepEqual(registrations[0], { kind: 'exact', path: '/_dsh/plugin/settings', handler });
});

test('each verb helper mounts a method-scoped route', () => {
  const cases = [
    ['get', 'GET'],
    ['post', 'POST'],
    ['put', 'PUT'],
    ['patch', 'PATCH'],
    ['del', 'DELETE'],
  ];
  for (const [method, expected] of cases) {
    const { ctx, registrations } = ctxWithWeb();
    createWebAPI({ ctx })[method]('/p', handler);
    assert.deepEqual(
      registrations[0],
      { kind: 'route', method: expected, path: '/p', handler },
      `${method}() must register method ${expected}`,
    );
  }
});

test('use mounts middleware', () => {
  const { ctx, registrations } = ctxWithWeb();
  createWebAPI({ ctx }).use(handler);
  assert.deepEqual(registrations[0], { kind: 'middleware', handler });
});

test('every registration returns a working disposer', () => {
  const { ctx, registrations } = ctxWithWeb();
  const web = createWebAPI({ ctx });
  const offs = [
    web.register('/a', handler),
    web.exact('/b', handler),
    web.get('/c', handler),
    web.post('/d', handler),
    web.put('/e', handler),
    web.patch('/f', handler),
    web.del('/g', handler),
    web.use(handler),
  ];
  assert.equal(registrations.length, 8);
  for (const off of offs) {
    assert.equal(typeof off, 'function');
    off();
  }
  assert.equal(registrations.length, 0, 'disposing every route empties the registry');
});

test('an absent webServer service throws DshLoaderWebError with the dshloader prefix', () => {
  const ctx = ctxWithoutWeb();
  const web = createWebAPI({ ctx });
  for (const call of [
    () => web.register('/a', handler),
    () => web.exact('/a', handler),
    () => web.get('/a', handler),
    () => web.put('/a', handler),
    () => web.del('/a', handler),
    () => web.use(handler),
  ]) {
    assert.throws(call, (error) => {
      assert.ok(error instanceof DshLoaderWebError);
      assert.match(error.message, /\[dshloader\]/);
      return true;
    });
  }
});

test('httpServer is accepted as the webServer alias', () => {
  const { ctx, registrations } = ctxWithWeb('httpServer');
  createWebAPI({ ctx }).exact('/aliased', handler);
  assert.equal(registrations.length, 1, 'the facade falls back to the httpServer alias');
});

test('registerUpgrade throws when the server cannot do upgrades', () => {
  const { ctx } = ctxWithWeb();
  assert.throws(
    () => createWebAPI({ ctx }).registerUpgrade({ path: '/ws', handler }),
    /registerUpgrade/,
  );
});
