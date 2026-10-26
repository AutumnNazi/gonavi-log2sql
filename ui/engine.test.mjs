// 跑 testdata/cases.json 共享向量：与 internal/convert_test.go 使用同一份数据，
// 双端任何一方行为变化都会在这里或 Go 测试中暴露。
// 运行：node --test ui/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import engine from './engine.js';

const file = JSON.parse(
  readFileSync(new URL('../testdata/cases.json', import.meta.url), 'utf8'),
);

assert.ok(file.cases.length > 0, '共享向量为空');

for (const tc of file.cases) {
  test(tc.name, () => {
    const got = engine.convert(tc.input, tc.dialect);
    const exp = tc.expected;
    assert.equal(got.statements.length, exp.statements.length, `语句数不符：结果 ${JSON.stringify(got)}`);
    for (let i = 0; i < exp.statements.length; i++) {
      const e = exp.statements[i];
      const a = got.statements[i];
      assert.equal(a.sql, e.sql, `sql 不符`);
      assert.equal(a.paramCount, e.paramCount, `paramCount 不符`);
      assert.equal(a.placeholderCount, e.placeholderCount, `placeholderCount 不符`);
      if (e.mapper !== undefined && e.mapper !== '') assert.equal(a.mapper, e.mapper, 'mapper 不符');
      if (e.time !== undefined) assert.equal(a.time ?? '', e.time, 'time 不符');
      if (e.traceId !== undefined && e.traceId !== '') assert.equal(a.traceId, e.traceId, 'traceId 不符');
      if (e.total !== undefined) assert.equal(a.total, e.total, 'total 不符');
      if (e.warningCount !== undefined) {
        assert.equal((a.warnings ?? []).length, e.warningCount, `语句 warnings 数不符：${JSON.stringify(a.warnings)}`);
      }
    }
    if (exp.warningCount !== undefined) {
      assert.equal((got.warnings ?? []).length, exp.warningCount, `整体 warnings 数不符：${JSON.stringify(got.warnings)}`);
    }
  });
}
