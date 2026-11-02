'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const acorn = require('acorn');
const walk = require('acorn-walk');
const en = require('../src/locales/en.json');
const zh = require('../src/locales/zh-CN.json');
const placeholders = value => [...value.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();
assert.deepEqual(Object.keys(en).sort(),Object.keys(zh).sort());
for(const [key,value] of Object.entries(en)) {
 assert.equal(typeof value,'string',key);
 assert.ok(value.trim(),key);
 assert.ok(!/\p{Script=Han}/u.test(value),`Untranslated English: ${key}`);
 assert.deepEqual(placeholders(value),placeholders(zh[key]),`Placeholders: ${key}`);
}
for(const file of ['src/core.cjs','src/export.cjs','src/plugin.cjs']) {
 const source = fs.readFileSync(file,'utf8');
 const ast=acorn.parse(source,{ecmaVersion:'latest',locations:true});
 walk.ancestor(ast,{
  CallExpression(node) {
   if(node.callee.name==='t') assert.ok(Object.hasOwn(en,node.arguments[0].value),`Unknown translation key in ${file}:${node.loc.start.line}`);
  },
  Literal(node,ancestors) {
   if(typeof node.value!=='string'|| !/\p{Script=Han}/u.test(node.value))return;
   const alias=ancestors.some(n=>n.type==='Property'&&n.key.name==='aliases');
   const search=ancestors.some(n=>n.type==='VariableDeclarator'&&n.id.name==='searchTerms');
   const selector=node.value==='简体中文';
   assert.ok(alias||search||selector,`Unlocalized literal in ${file}:${node.loc.start.line}`);
  },
  TemplateElement(node) {
   assert.ok(!/\p{Script=Han}/u.test(node.value.cooked||''),`Unlocalized template in ${file}:${node.loc.start.line}`);
  }
 });
}
console.log(`Catalog parity, interpolation, keys, and Chinese literal audit passed (${Object.keys(en).length} keys).`);
