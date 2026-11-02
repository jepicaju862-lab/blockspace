'use strict';
const en = require('./locales/en.json');
const zh = require('./locales/zh-CN.json');
const catalogs = { en, 'zh-CN': zh };
let language = 'en';
function normalizeLanguage(value) { return value === 'zh-CN' ? 'zh-CN' : 'en'; }
function setLanguage(value) { language = normalizeLanguage(value); return language; }
function getLanguage() { return language; }
function translate(key, values = [], locale = language) {
  const catalog = catalogs[normalizeLanguage(locale)];
  const message = catalog[key] ?? en[key] ?? key;
  return message.replace(/\{(\d+)\}/g, (token, index) => index < values.length ? String(values[index]) : token);
}
module.exports = { t: translate, translate, setLanguage, getLanguage, normalizeLanguage };
