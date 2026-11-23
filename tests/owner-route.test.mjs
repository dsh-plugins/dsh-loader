import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownerRoute } from '../dist/index.js';

const live = new AbortController().signal;

for (const [name, connection, peer, expected] of [
  ['旧宿主优先使用旧认证入口', { admit() {}, requestRejection() {} }, undefined, 200],
  ['旧宿主拒绝未认证请求', { requestRejection: () => 401 }, undefined, 401],
  ['旧宿主拒绝跨站请求', { requestRejection: () => 403 }, undefined, 403],
  ['新版接受有效属主', { admit() {} }, { signal: live, principal: { kind: 'owner' } }, 200],
  ['新版拒绝非属主', { admit() {} }, { signal: live, principal: { kind: 'remote' } }, 403],
  ['新版拒绝过期属主', { admit() {} }, { signal: AbortSignal.abort(), principal: { kind: 'owner' } }, 401],
  ['新版缺少已准入属主', { admit() {} }, undefined, 503],
  ['宿主缺少认证能力', undefined, undefined, 503],
]) {
  test(name, async () => {
    let status;
    const response = { writeHead(code) { status = code; }, end() {} };
    const route = ownerRoute(connection, {
      kind: 'exact', path: '/plugin', async handler(_req, res) { res.writeHead(200); },
    });
    await route.handler({}, response, peer);
    assert.equal(status, expected);
  });
}
