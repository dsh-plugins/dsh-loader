import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDshSymbolsAPI } from '../dist/adapters/shared/dsh-symbols.js';
import { supportsSessionClient } from '../dist/session-version.js';
test('会话客户端接受已适配的候选版本与新宿主', () => {
  for (const v of ['0.2.2-rc.1', '0.2.2-rc.3', '0.2.2-rc.4', '0.2.2-rc.5', '0.2.3-alpha.2']) {
    assert.equal(supportsSessionClient(v), true, v);
  }
  for (const v of ['0.2.2-alpha.3', '0.2.2-rc.6', '0.2.2-rc.50']) {
    assert.equal(supportsSessionClient(v), false, v);
  }
});

test('Typert 复用宿主基类和方法标记，只公开明确列出的原型方法', () => {
  const marks = new Map();
  class Base {}
  const dsh = createDshSymbolsAPI({ modules: {
    typert: {
      TypertRemoteService: Base,
      Remote(method, context) {
        assert.equal(context.kind, 'method');
        assert.equal(context.static, false);
        context.addInitializer(function () {
          marks.set(context.name, { self: this, method });
        });
      },
    },
  } });
  assert.equal(dsh.typert.TypertRemoteService, Base);
  class Service extends dsh.typert.TypertRemoteService {
    exposed() {}
    hidden() {}
  }
  const service = new Service();
  dsh.typert.exposeDirectMethods(service, ['exposed']);
  assert.deepEqual([...marks], [['exposed', { self: service, method: Service.prototype.exposed }]]);
  assert.throws(() => dsh.typert.exposeDirectMethods(service, ['missing']), /远程方法不存在/);
});
