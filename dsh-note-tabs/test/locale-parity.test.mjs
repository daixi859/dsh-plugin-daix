// client 文案表一致性：中英文键集必须相同，且每种语言都不留空值。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'lib', 'client.js'), 'utf8');

/** 抽出 DICT 里的一个语言块，返回键数组与键值对。 */
function langBlock(lang) {
  const start = source.indexOf('      ' + lang + ': {');
  assert.ok(start > 0, lang + ' 块存在');
  const end = source.indexOf('\n      },', start);
  assert.ok(end > start, lang + ' 块有闭合');
  const block = source.slice(start, end);
  const keys = [];
  const re = /^\s{8}([a-zA-Z]+):/gm;
  let match;
  while ((match = re.exec(block)) !== null) keys.push(match[1]);
  return keys;
}

test('中英文文案键集一致', () => {
  const zh = langBlock('zh');
  const en = langBlock('en');
  assert.ok(zh.length > 20, '中文键数量正常');
  assert.deepEqual([...zh].sort(), [...en].sort());
});

test('代码里用到的每个 t() 键都在两套文案里', () => {
  const used = new Set();
  const re = /\bt\("([a-zA-Z]+)"/g;
  let match;
  while ((match = re.exec(source)) !== null) used.add(match[1]);
  const zh = new Set(langBlock('zh'));
  const en = new Set(langBlock('en'));
  const missing = [...used].filter((key) => !zh.has(key) || !en.has(key));
  assert.deepEqual(missing, []);
});

test('文案表里没有未使用的死键', () => {
  const used = new Set();
  const re = new RegExp('t\\("([a-zA-Z]+)"', 'g');
  let match;
  while ((match = re.exec(source)) !== null) used.add(match[1]);
  const unused = langBlock('zh').filter((key) => !used.has(key));
  assert.deepEqual(unused, []);
});