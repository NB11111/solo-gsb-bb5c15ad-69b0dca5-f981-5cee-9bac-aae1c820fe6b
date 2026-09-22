'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/foldEngine.js');

const STEPS_2x2 = [
  { axis: 'v', line: 1, dir: 'r' },
  { axis: 'h', line: 1, dir: 'd' }
];
// 2×2 全标注：阅读序列 3,4,1,7,2,8,5,6（1..8 各出现一次）
const LABELS_2x2 = {
  '0,0': { front: '4', back: '5' }, '1,0': { front: '6', back: '3' },
  '0,1': { front: '8', back: '1' }, '1,1': { front: '7', back: '2' }
};
const codes = (r) => r.findings.map((f) => f.code);

test('审计：1×1 全标注无步骤 → 全部通过、可发布', () => {
  const r = E.auditPlan(1, 1, { '0,0': { front: '1', back: '2' } }, []);
  assert.equal(r.ok, true);
  assert.equal(r.aborted, false);
  assert.equal(r.replayedSteps, 0);
  assert.deepEqual(r.plan, { rows: 1, cols: 1, steps: 0, capacity: 2 });
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.verdict, 'publishable');
  assert.equal(r.summary.errors, 0);
  assert.equal(r.summary.warnings, 0);
  assert.ok(r.summary.message.includes('可发布'));
});

test('审计：2×2 全标注折帖 → 仅倒置警告，仍可发布', () => {
  const r = E.auditPlan(2, 2, LABELS_2x2, STEPS_2x2);
  assert.equal(r.ok, true);
  assert.equal(r.aborted, false);
  assert.equal(r.replayedSteps, 2);
  assert.deepEqual(codes(r), ['inverted_page']);
  const f = r.findings[0];
  assert.equal(f.severity, 'warning');
  // 格(0,0) 与格(1,0) 两片各贡献上/下两个倒置槽位
  assert.equal(f.locations.length, 4);
  assert.ok(f.locations.every((l) => /^[01],[01]$/.test(l.cell)));
  assert.ok(f.locations.every((l) => l.stack === '1,1'));
  assert.equal(r.summary.verdict, 'publishable');
  assert.equal(r.summary.warnings, 1);
});

test('审计：首个非法步骤即中止，不伪造后续交付结论', () => {
  const r = E.auditPlan(1, 3, {}, [
    { axis: 'v', line: 1, dir: 'r' },
    { axis: 'v', line: 2, dir: 'l' }   // 1 层压向 2 层：厚度冲突
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.aborted, true);
  assert.equal(r.replayedSteps, 1);
  assert.equal(r.findings.length, 1, '中止时只报告首个错误');
  const f = r.findings[0];
  assert.equal(f.code, 'invalid_step');
  assert.equal(f.severity, 'error');
  assert.equal(f.stepIndex, 1);
  assert.equal(f.foldCode, 'thickness');
  assert.deepEqual(f.conflicts, ['2,0', '1,0']);
  assert.deepEqual(f.step, { axis: 'v', line: 2, dir: 'l' });
  assert.ok(f.message.includes('第 2 步'));
  assert.equal(r.summary.verdict, 'needs_revision');
  assert.ok(r.summary.message.includes('中止'));
});

test('审计：分离叠层为错误并给出各叠格位与厚度', () => {
  const r = E.auditPlan(2, 3, {}, [{ axis: 'v', line: 1, dir: 'r' }]);
  assert.equal(r.aborted, false);
  const f = r.findings.find((x) => x.code === 'separated_stacks');
  assert.ok(f);
  assert.equal(f.severity, 'error');
  assert.equal(f.stacks.length, 4);
  assert.ok(f.message.includes('4 个分离叠层'));
  assert.ok(f.stacks.every((s) => /^\d,\d$/.test(s.cell) && s.depth >= 1));
  assert.equal(r.summary.verdict, 'needs_revision');
});

test('审计：重复页码逐条给出涉及原始纸格与面', () => {
  const r = E.auditPlan(1, 2, {
    '0,0': { front: '1', back: '2' },
    '1,0': { front: '2', back: '3' }
  }, [{ axis: 'v', line: 1, dir: 'r' }]);
  const dups = r.findings.filter((f) => f.code === 'duplicate_page');
  assert.equal(dups.length, 1, '同一页码的重复合并为一条结果');
  const d = dups[0];
  assert.equal(d.severity, 'error');
  assert.equal(d.page, '2');
  assert.equal(d.locations.length, 2);
  assert.deepEqual(d.locations.map((l) => l.cell).sort(), ['0,0', '1,0']);
  assert.ok(d.message.includes('“2”'));
  assert.equal(r.summary.verdict, 'needs_revision');
});

test('审计：空白页码与未覆盖纸格为警告，不阻断发布', () => {
  const r = E.auditPlan(2, 2, {}, STEPS_2x2);
  const blank = r.findings.find((f) => f.code === 'blank_page');
  const uncov = r.findings.find((f) => f.code === 'uncovered_cell');
  assert.ok(blank && uncov);
  assert.equal(blank.severity, 'warning');
  assert.equal(blank.locations.length, 8);
  assert.ok(blank.locations.every((l) => l.label === null));
  assert.equal(uncov.severity, 'warning');
  assert.deepEqual(uncov.cells, ['0,0', '1,0', '0,1', '1,1']);
  assert.equal(r.summary.errors, 0);
  assert.equal(r.summary.verdict, 'publishable');
});

test('审计：数字页码超出折帖容量为错误；非数字页码不参与容量检查', () => {
  const r = E.auditPlan(1, 2, {
    '0,0': { front: '1', back: '9' },
    '1,0': { front: '2', back: '3' }
  }, [{ axis: 'v', line: 1, dir: 'r' }]);
  const f = r.findings.find((x) => x.code === 'page_out_of_capacity');
  assert.ok(f);
  assert.equal(f.severity, 'error');
  assert.equal(f.capacity, 4);
  assert.equal(f.locations.length, 1);
  assert.equal(f.locations[0].label, '9');
  assert.equal(f.locations[0].cell, '0,0');
  assert.equal(f.locations[0].face, 'back');
  assert.equal(r.summary.verdict, 'needs_revision');

  // 非数字页码（如“封面”）无法按容量判定，不触发本项
  const r2 = E.auditPlan(1, 1, { '0,0': { front: '封面', back: '封底' } }, []);
  assert.deepEqual(r2.findings, []);
  assert.equal(r2.summary.verdict, 'publishable');
});

test('审计：重复且超容量的页码两类错误各自成条', () => {
  const r = E.auditPlan(1, 2, {
    '0,0': { front: '9', back: '1' },
    '1,0': { front: '9', back: '2' }
  }, [{ axis: 'v', line: 1, dir: 'r' }]);
  const list = codes(r);
  assert.ok(list.includes('duplicate_page'));
  assert.ok(list.includes('page_out_of_capacity'));
  assert.equal(r.findings.find((f) => f.code === 'page_out_of_capacity').locations.length, 2);
  assert.equal(r.summary.errors, 2);
  assert.equal(r.summary.verdict, 'needs_revision');
});

test('审计：非法网格返回 bad_grid；审计不修改输入方案', () => {
  const bad = E.auditPlan(0, 2, {}, []);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'bad_grid');

  const labels = { '0,0': { front: '1', back: '2' } };
  const steps = [{ axis: 'v', line: 1, dir: 'r' }];
  const snapshot = JSON.stringify({ labels, steps });
  E.auditPlan(1, 2, labels, steps);
  assert.equal(JSON.stringify({ labels, steps }), snapshot, '审计只读，不得改动输入');
});
