import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownerRoute } from '../dist/index.js';

const live = new AbortController().signal;
const owner = { signal: live, principal: { kind: 'owner' } };
const remote = { signal: live, principal: { kind: 'remote' } };

for (const [name, connection, peer, expected, headers = {}] of [
  ['旧宿主接受已准入属主', { admit: () => ({ peer: owner }) }, undefined, 200],
  ['旧宿主拒绝已准入的非属主', { admit: () => ({ peer: remote }) }, undefined, 403],
  ['旧宿主拒绝未认证请求', { admit: () => ({ rejection: 401 }) }, undefined, 401],
  ['宿主拒绝带属主身份的跨站请求', undefined, owner, 403, { 'sec-fetch-site': 'cross-site' }],
  ['新版接受有效属主', undefined, owner, 200],
  ['新版拒绝非属主', undefined, remote, 403],
  ['新版拒绝过期属主', undefined, { ...owner, signal: AbortSignal.abort() }, 401],
  ['宿主缺少认证能力', undefined, undefined, 503],
]) {
  test(name, async () => {
    let status;
    const response = { writeHead(code) { status = code; }, end() {} };
    const route = ownerRoute(connection, {
      kind: 'exact', path: '/plugin', async handler(_req, res) { res.writeHead(200); },
    });
    await route.handler({ headers }, response, peer);
    assert.equal(status, expected);
  });
}
