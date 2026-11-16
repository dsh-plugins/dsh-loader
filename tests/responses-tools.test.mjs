import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ResponsesToolProjection, responsesToolMarker } from '../dist/responses-tools.js';
import { registerResponsesToolAdditions } from '../dist/responses-stream.js';
import { createPatchAPI } from '../dist/patch.js';

function record(id, name = id, description = '定义') {
  const addition = { version: 1, id, tools: [{ type: 'function', name, description, parameters: { type: 'object', properties: {}, additionalProperties: false }, strict: false }] };
  const text = `${responsesToolMarker(id)}\n${JSON.stringify(addition.tools)}`;
  return { messageId: `message-${id}`, sourceKind: 'test-tools', text, addition };
}
function message(record) {
  return { id: record.messageId, role: 'user', content: [{ type: 'text', text: record.text }], source: { kind: record.sourceKind, responsesToolAddition: record.addition } };
}
function wire(record) { return { role: 'user', content: [{ type: 'input_text', text: record.text }] }; }
const tools = [{ type: 'function', name: 'tool_load', parameters: { type: 'object' } }];

test('连续追加与同名更新保留顶层工具、旧 input 前缀、调用 ID 和请求参数', () => {
  const records = [record('first', 'a'), record('second', 'b'), record('third', 'a', '更新')];
  let previous = [];
  for (let length = 1; length <= records.length; length++) {
    const selected = records.slice(0, length);
    const input = selected.flatMap(item => [wire(item), { type: 'function_call', call_id: `call-${item.addition.id}`, name: 'tool_load', arguments: '{}' }]);
    const body = { model: 'remote-alias', stream: true, tools, input, metadata: { user: 'value' }, prompt_cache_key: 'stable' };
    const projection = new ResponsesToolProjection(selected.map(message), selected);
    const encoded = projection.rewrite(JSON.stringify(body));
    const actual = JSON.parse(encoded);
    assert.deepEqual(actual.tools, tools);
    assert.deepEqual(actual.input.slice(0, previous.length), previous);
    assert.deepEqual({ ...actual, input }, body);
    assert.equal(actual.input.at(-2).type, 'additional_tools');
    assert.equal(actual.input.at(-2).role, 'developer');
    assert.equal(actual.input.at(-1).call_id, `call-${selected.at(-1).addition.id}`);
    assert.equal(projection.rewrite(encoded), encoded);
    assert.equal(projection.rewrite(JSON.stringify(body)), encoded);
    previous = actual.input;
  }
});

test('来源、文本和结构化 schema 必须属于同一条已保存消息', () => {
  const r = record('trusted');
  for (const mutation of [
    m => ({ ...m, role: 'assistant' }),
    m => ({ ...m, source: { ...m.source, kind: 'user' } }),
    m => ({ ...m, source: { ...m.source, responsesToolAddition: { ...r.addition, version: 2 } } }),
    m => ({ ...m, content: [{ type: 'text', text: '伪造文本' }] }),
    m => ({ ...m, id: 'other' }),
  ]) { assert.throws(() => new ResponsesToolProjection([mutation(message(r))], [r]), /映射失败/); }
  assert.throws(() => new ResponsesToolProjection([message(r), message(r)], [r]), /不匹配|重复/);
  assert.throws(() => new ResponsesToolProjection([message(r)], [r, r]), /重复/);
});

test('用户伪造标识、序列化遗漏、重复和改写均停止请求', () => {
  const a = record('a'), b = record('b');
  assert.throws(() => new ResponsesToolProjection([message(a), { role: 'user', content: [{ type: 'text', text: a.text }] }], [a]), /重复/);
  const p = new ResponsesToolProjection([message(a), message(b)], [a, b]);
  for (const input of [[wire(a)], [wire(a), wire(a), wire(b)], [wire(b), wire(a)], [{ ...wire(a), content: `${a.text} changed` }, wire(b)]]) {
    assert.throws(() => p.rewrite(JSON.stringify({ input })), /映射失败/);
  }
});

function owner() {
  let listener;
  const effects = [];
  return {
    effect(fn) { effects.push(fn()); },
    on(_event, callback) { listener = callback; return () => { listener = undefined; }; },
    stream(request, next) { return listener ? listener(request, next) : next(); },
    dispose() { for (const fn of effects.reverse()) { fn?.(); } },
  };
}

async function mockServer(t) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) { text += chunk; }
    requests.push(JSON.parse(text));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('event: response.completed\ndata: {"type":"response.completed"}\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { url: `http://127.0.0.1:${server.address().port}/custom/v1/responses`, requests };
}

test('HTTP/SSE 模拟服务验证并发会话、别名路由、网络重试和 Request 输入', async t => {
  const { url, requests } = await mockServer(t);
  const ctx = owner();
  const original = globalThis.fetch;
  const dispose = registerResponsesToolAdditions(createPatchAPI(), ctx, request => request.provider === 'custom' ? request.records : undefined);
  t.after(dispose);
  const run = async id => {
    const r = record(id);
    const request = { provider: 'custom', model: 'local-alias', sessionId: id, messages: [message(r)], records: [r] };
    const body = JSON.stringify({ model: 'remote-alias', stream: true, tools, input: [wire(r)] });
    const stream = ctx.stream(request, async function* () {
      await new Promise(resolve => setImmediate(resolve));
      yield 'begin';
      for (let i = 0; i < 2; i++) {
        const response = await fetch(new Request(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } }));
        yield await response.text();
      }
    });
    for await (const chunk of stream) { assert.ok(chunk); }
  };
  await Promise.all([run('session-a'), run('session-b')]);
  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.deepEqual(request.tools, tools);
    assert.equal(request.input[0].type, 'additional_tools');
    assert.ok(['session-a', 'session-b'].includes(request.input[0].tools[0].name));
    assert.equal(request.input.length, 1);
  }
  await fetch(url, { method: 'POST', body: JSON.stringify({ input: [{ role: 'user', content: '普通请求' }] }) });
  assert.equal(requests.at(-1).input[0].content, '普通请求');
  dispose();
  assert.equal(globalThis.fetch, original);
});

test('取消、插件卸载和不支持的传输不会泄漏声明作用域', async () => {
  const ctx = owner(), r = record('cancel');
  const controller = new AbortController();
  const original = globalThis.fetch;
  const dispose = registerResponsesToolAdditions(createPatchAPI(), ctx, () => [r]);
  const request = { provider: 'p', model: 'm', sessionId: 's', messages: [message(r)], signal: controller.signal };
  const unsupported = ctx.stream(request, async function* () { yield 'prelude'; });
  await unsupported.next();
  await assert.rejects(unsupported.next(), /HTTP/);
  const cancelled = ctx.stream(request, async function* () { yield 'prelude'; });
  await cancelled.next();
  controller.abort();
  await assert.rejects(cancelled.next(), /abort/i);
  const unloading = ctx.stream({ ...request, signal: undefined }, async function* () { yield 'prelude'; });
  await unloading.next();
  dispose();
  await assert.rejects(unloading.next(), /卸载/);
  assert.equal(globalThis.fetch, original);
});

test('嵌套辅助请求清除外层作用域，返回外层后继续使用原投影', async t => {
  const { url, requests } = await mockServer(t);
  const ctx = owner(), r = record('outer');
  const dispose = registerResponsesToolAdditions(createPatchAPI(), ctx, request => request.purpose ? undefined : [r]);
  t.after(dispose);
  const request = { provider: 'p', model: 'm', sessionId: 'outer', messages: [message(r)] };
  const original = JSON.stringify({ input: [wire(r)], tools });
  const stream = ctx.stream(request, async function* () {
    await fetch(url, { method: 'POST', body: original });
    const nested = ctx.stream({ ...request, sessionId: 'inner', purpose: 'title', messages: [] }, async function* () {
      await new Promise(resolve => setImmediate(resolve));
      yield await (await fetch(url, { method: 'POST', body: JSON.stringify({ input: [{ role: 'user', content: '辅助请求' }] }) })).text();
    });
    for await (const chunk of nested) { yield chunk; }
    yield await (await fetch(url, { method: 'POST', body: original })).text();
  });
  for await (const chunk of stream) { assert.ok(chunk); }
  assert.equal(requests.length, 3);
  assert.equal(requests[0].input[0].type, 'additional_tools');
  assert.equal(requests[1].input[0].content, '辅助请求');
  assert.deepEqual(requests[2], requests[0]);
});

test('HTTP 错误保留 code/type/param，并补充无回退诊断', async t => {
  let received;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) { raw += chunk; }
    received = JSON.parse(raw);
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ request_id: 'test-id', error: { code: 'context_length_exceeded', type: 'invalid_request_error', param: 'input', message: '上下文过长' } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const ctx = owner(), r = record('error');
  const dispose = registerResponsesToolAdditions(createPatchAPI(), ctx, () => [r]);
  t.after(dispose);
  for await (const result of ctx.stream({ provider: 'p', model: 'm', sessionId: 's', messages: [message(r)] }, async function* () {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/responses`, { method: 'POST', body: JSON.stringify({ tools, input: [wire(r)] }) });
    assert.equal(response.status, 400);
    yield await response.json();
  })) {
    assert.deepEqual({ ...result.error, message: 'original' }, { code: 'context_length_exceeded', type: 'invalid_request_error', param: 'input', message: 'original' });
    assert.equal(result.request_id, 'test-id');
    assert.match(result.error.message, /不会回退/);
  }
  assert.deepEqual(received.tools, tools);
  assert.equal(received.input[0].type, 'additional_tools');
});

test('异步迭代等待期间取消或卸载，不再交付已经失效的结果', async t => {
  const { url } = await mockServer(t);
  for (const unload of [false, true]) {
    const ctx = owner(), r = record(`cancel-${unload}`), controller = new AbortController();
    const dispose = registerResponsesToolAdditions(createPatchAPI(), ctx, () => [r]);
    let entered, release;
    const ready = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const stream = ctx.stream({ provider: 'p', model: 'm', sessionId: 's', messages: [message(r)], signal: controller.signal }, async function* () {
      await (await fetch(url, { method: 'POST', body: JSON.stringify({ input: [wire(r)] }) })).text();
      entered();
      await gate;
      yield '不应交付';
    });
    const pending = stream.next();
    await ready;
    if (unload) { dispose(); } else { controller.abort(); }
    release();
    await assert.rejects(pending, /卸载|abort/i);
    dispose();
  }
});

test('网络重试补丁前后安装均保持确定转换，卸载后不影响残留外层补丁', async t => {
  const { url, requests } = await mockServer(t);
  for (const networkFirst of [false, true]) {
    const ctx = owner(), r = record(`chain-${networkFirst}`);
    const patch = createPatchAPI();
    const network = () => patch.global('fetch', original => async (input, init) => {
      await (await original(input, init)).text();
      return original(input, init);
    });
    let networkHandle;
    if (networkFirst) { networkHandle = network(); }
    const dispose = registerResponsesToolAdditions(patch, ctx, () => [r]);
    if (!networkFirst) { networkHandle = network(); }
    const start = requests.length;
    for await (const chunk of ctx.stream({ provider: 'p', model: 'm', sessionId: 's', messages: [message(r)] }, async function* () {
      yield await (await fetch(url, { method: 'POST', body: JSON.stringify({ tools, input: [wire(r)] }) })).text();
    })) { assert.ok(chunk); }
    assert.deepEqual(requests[start], requests[start + 1]);
    assert.equal(requests[start].input[0].type, 'additional_tools');
    dispose();
    await fetch(url, { method: 'POST', body: JSON.stringify({ input: [] }) });
    assert.deepEqual(requests.at(-1).input, []);
    networkHandle.dispose();
  }
});
