'use strict';
const {test,afterEach} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const path = require('node:path');
const i18n = require('../src/i18n.cjs');
const Core = require('../src/core.cjs');
const Exporters = require('../src/export.cjs');
const en = require('../src/locales/en.json');
const zh = require('../src/locales/zh-CN.json');
const key = value => Object.keys(en).find(k=>en[k]===value);
afterEach(()=>i18n.setLanguage('en'));
function pluginModule(bundle=false) {
 const filename=path.resolve(bundle?'main.js':'src/plugin.cjs');
 const localRequire=createRequire(filename);
 class Stub { constructor(app,plugin){this.app=app;this.plugin=plugin;this.containerEl={};} }
 class Setting {
  constructor(container){this.record={};(container.settings ||= []).push(this.record);}
  setName(value){this.record.name=value;return this;} setDesc(value){this.record.description=value;return this;}
  control(kind,callback){const record={kind,options:{}};this.record.control=record;
   const chain=new Proxy({}, {get(_target,method){return (...args)=>{if(method==='addOption')record.options[args[0]]=args[1];if(method==='onChange')record.change=args[0];if(method==='setValue')record.value=args[0];return chain;};}});callback(chain);return this;}
  addDropdown(cb){return this.control('dropdown',cb);} addText(cb){return this.control('text',cb);} addToggle(cb){return this.control('toggle',cb);} addSlider(cb){return this.control('slider',cb);} addButton(cb){return this.control('button',cb);}
 }
 class Plugin {
  constructor(){this.commands=[];this.viewFactories={};this.app={workspace:{on(){},onLayoutReady(){}},vault:{adapter:{},on(){}}};}
  async loadData(){return this.saved;}
  async saveData(data){this.saved=JSON.parse(JSON.stringify(data));}
  registerView(id,factory){this.viewFactories[id]=factory;}
  addCommand(command){this.commands.push(command);}
  addRibbonIcon(){} addSettingTab(tab){this.tab=tab;} registerEvent(){}
 }
 const obsidian={Setting,Notice:Stub,Plugin,Component:Stub,FuzzySuggestModal:Stub,ItemView:Stub,Modal:Stub,PluginSettingTab:Stub,TFile:Stub,normalizePath:x=>x};
 const module={exports:{}};
 const source=fs.readFileSync(filename,'utf8')+(bundle?'':'\nmodule.exports.testHooks = { getCommands:()=>SLASH_COMMANDS, scoreSlashCommand, BlockspaceStore };');
 vm.runInNewContext(source,{module,exports:module.exports,require:id=>id==='obsidian'?obsidian:localRequire(id),console,TextEncoder,TextDecoder,setTimeout,clearTimeout,URL,Uint8Array,ArrayBuffer,Buffer},{filename});
 return module.exports;
}
test('English default, unsupported locale fallback, interpolation, and missing key',()=>{
 assert.equal(i18n.getLanguage(),'en');
 assert.equal(i18n.t(key('Column {0}'),[4]),'Column 4');
 assert.equal(i18n.setLanguage('fr'),'en');
 assert.equal(i18n.t('unknown.key'),'unknown.key');
 i18n.setLanguage('zh-CN');
 const k=key('Open workspace');const original=zh[k];delete zh[k];
 try{assert.equal(i18n.t(k),'Open workspace');}finally{zh[k]=original;}
 assert.equal(i18n.t(key('Column {0}'),['$& {1} 中文']),'列 $& {1} 中文');
});
test('new welcome pages and table defaults follow selected language',()=>{
 assert.equal(Core.createDefaultPage().title,'Welcome to Blockspace');
 assert.equal(Core.normalizeTableData({}).columns[0].name,'Column 1');
 i18n.setLanguage('zh-CN');
 assert.equal(Core.createDefaultPage().title,'欢迎使用 Blockspace');
 assert.equal(Core.normalizePage({}).title,'未命名');
 assert.equal(Core.normalizeTableData({}).columns[0].name,'列 1');
});
test('existing mixed-language content and identifiers survive normalization and sidecar round trip',()=>{
 i18n.setLanguage('zh-CN');const page=Core.createDefaultPage('我的页面 / English');
 page.blocks[0].text='中文 heading';page.properties.custom=[{id:'custom-1',name:'自定义',type:'text',value:'保留 / keep'}];
 const before=JSON.stringify(page);i18n.setLanguage('en');
 assert.equal(JSON.stringify(Core.normalizePage(page)),before);
 const markdown=Exporters.losslessMarkdownForPage(page);
 const sidecar=Exporters.losslessSidecarForPage(page,'Blockspace Exports/example.md');
 const restored=Exporters.extractLosslessSidecar(sidecar,markdown);
 assert.ok(restored);assert.equal(restored.id,page.id);assert.equal(restored.title,page.title);
 assert.deepEqual(restored.blocks,page.blocks);assert.deepEqual(restored.properties,page.properties);
 assert.equal(JSON.stringify(page),before);
});
test('export labels and document language follow locale while user content stays intact',()=>{
 const page=Core.createDefaultPage('中文 / English');page.blocks[0].text='用户内容';
 let html=Exporters.htmlDocumentForPage(page);
 assert.match(html,/<html lang="en">/);assert.match(html,/>Status</);assert.match(html,/用户内容/);
 let word=Buffer.from(Exporters.docxForPage(page)).toString('utf8');assert.match(word,/w:val="en-US"/);
 i18n.setLanguage('zh-CN');html=Exporters.htmlDocumentForPage(page);
 assert.match(html,/<html lang="zh-CN">/);assert.match(html,/>状态</);
});
test('plugin defaults, persisted Chinese selection, and bilingual slash searches',async()=>{
 const Plugin=pluginModule();const plugin=new Plugin();await plugin.onload();
 assert.equal(plugin.settings.language,'en');assert.equal(plugin.commands.find(c=>c.id==='open-workspace').name,'Open workspace');
 const englishIds=plugin.commands.map(c=>c.id);
 for(const query of ['标题','heading','h1'])assert.ok(Plugin.testHooks.getCommands().some(c=>Plugin.testHooks.scoreSlashCommand(c,query)>0),query);
 plugin.settings.language='zh-CN';await plugin.saveSettings();
 const next=new Plugin();next.saved=plugin.saved;await next.onload();
 assert.equal(next.settings.language,'zh-CN');assert.equal(next.commands.find(c=>c.id==='open-workspace').name,'打开工作台');
 assert.deepEqual(next.commands.map(c=>c.id),englishIds);
 assert.equal(Plugin.testHooks.getCommands().find(c=>c.type==='heading-1').label,'一级标题');
 for(const query of ['标题','heading'])assert.ok(Plugin.testHooks.getCommands().some(c=>Plugin.testHooks.scoreSlashCommand(c,query)>0),query);
});
test('shipped bundle exports the Blockspace plugin and starts in both languages',async()=>{
 const Plugin=pluginModule(true);
 for(const language of ['en','zh-CN']){const plugin=new Plugin();plugin.saved={language};await plugin.onload();assert.equal(plugin.settings.language,language);assert.ok(plugin.commands.some(c=>c.id==='open-workspace'));assert.ok(!plugin.commands.some(c=>/timeline|transcri/.test(c.id)));}
});

test('settings renders language selector and saves choice without switching until reload',async()=>{
 const Plugin=pluginModule();const plugin=new Plugin();await plugin.onload();plugin.tab.display();
 const setting=plugin.tab.containerEl.settings.find(s=>s.name==='Interface language');
 assert.ok(setting,'language selector must be visible');
 assert.deepEqual(setting.control.options,{'en':'English','zh-CN':'简体中文'});
 await setting.control.change('zh-CN');assert.equal(plugin.saved.language,'zh-CN');
 assert.equal(i18n.getLanguage(),'en');
 const next=new Plugin();next.saved=plugin.saved;await next.onload();next.tab.display();
 assert.ok(next.tab.containerEl.settings.some(s=>s.name==='界面语言'));
});

test('installation stylesheet belongs to Blockspace and contains no hardcoded Chinese UI',()=>{
 const css=fs.readFileSync(path.resolve('styles.css'),'utf8');
 assert.match(css,/\.blockspace-workspace/);
 assert.match(css,/\.bs-block-editor/);
 assert.ok(!css.includes('.child-timeline-wrapper'));
 assert.ok(!/\p{Script=Han}/u.test(css));
 assert.match(css,/content: attr\(data-collapsed-label\)/);
});
