import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../dist/services/config.js';
import { installConfigBridge } from '../dist/services/config-bridge.js';

test('configuration HTTP authenticates reads, validates writes, fences revisions and subscribes independently', async t => {
  const profile = await mkdtemp(join(tmpdir(), 'dsh-config-http-'));
  const store = new ConfigStore(profile), owner = { effect(fn) { this.release = fn(); } };
  await store.register(owner, { id:'http', packageName:'http-example', title:'HTTP', fields:[{type:'text', key:'name',label:'Name', default:'first',required:true}] });
  let handler, removed = false;
  const off = installConfigBridge({ register(_path, fn) { handler = fn; return () => { removed = true; }; } }, store, (request, response) => {
    if (request.headers.cookie === 'session=test') return true;
    response.writeHead(401); response.end(); return false;
  });
  const server = createServer((req,res) => handler(req,res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { off(); owner.release(); store.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(profile,{recursive:true,force:true}); });
  const url = `http://127.0.0.1:${server.address().port}/api/dshloader/config`;
  const headers = { cookie:'session=test', 'content-type':'application/json' };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url,{headers:{...headers,origin:'https://elsewhere.example'}})).status,403);
  const read = await (await fetch(url,{headers})).json(); assert.equal(read.value.length,1);
  const post = body => fetch(url+'/http',{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await post({value:{name:''},expectedRevision:0})).status,400);
  const abort = new AbortController(); const stream = await fetch(url+'/events',{headers,signal:abort.signal});
  const reader = stream.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value), /event: change/);
  assert.equal((await post({value:{name:'saved'},expectedRevision:0})).status,200);
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: change/);
  assert.equal((await post({value:{name:'stale'},expectedRevision:0})).status,409);
  assert.equal((await fetch(url+'/unregistered',{headers})).status,404);
  abort.abort(); off(); off(); assert.equal(removed,true);
});
