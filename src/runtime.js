'use strict';
const fs = require('node:fs');
const path = require('node:path');
function input(name, fallback = '') {
  const key = 'INPUT_' + name.replace(/ /g, '_').toUpperCase();
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value.trim();
}
function required(name) {
  const value = input(name);
  if (!value) throw new Error('Informe o parâmetro obrigatório ' + name + '.');
  return value;
}
function yes(name, fallback = false) {
  const val = input(name, String(fallback)).toLowerCase();
  if (!['true', 'false'].includes(val)) throw new Error('Parâmetro booleano inválido: ' + name);
  return val === 'true';
}
function number(name, fallback, max = 500) {
  const val = Number(input(name, String(fallback)));
  if (!Number.isSafeInteger(val) || val < 1 || val > max) throw new Error('Número fora do intervalo em ' + name);
  return val;
}
function commandEscape(value) {
  return String(value).replace(/%/g,'%AZP25').replace(/\r/g,'%0D').replace(/\n/g,'%0A')
    .replace(/;/g,'%3B').replace(/]/g,'%5D');
}
function variable(name, value) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error('Nome de variável inválido.');
  console.log('##vso[task.setvariable variable=' + name + ';]' + commandEscape(value));
}
function issue(type, message) {
  console.log('##vso[task.logissue type=' + type + ';]' + commandEscape(message));
}
function finish(ok, message) {
  console.log('##vso[task.complete result=' + (ok ? 'Succeeded' : 'Failed') + ';]' + commandEscape(message));
}
function safePath(value) {
  const filename = path.resolve(value);
  fs.mkdirSync(path.dirname(filename), {recursive:true});
  return filename;
}
function save(filename, content) {
  if (!filename) return;
  const target = safePath(filename);
  fs.writeFileSync(target, content, {encoding:'utf8',flag:'w',mode:0o600});
  console.log('Arquivo de saída criado: ' + target);
}
function refName(name, kind) {
  const prefix = kind === 'tag' ? 'refs/tags/' : 'refs/heads/';
  const raw = String(name||'').trim();
  const short = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  if (!short || short.length > 240 || short.endsWith('.') || short.endsWith('/') ||
      short.startsWith('/') || short.startsWith('.') || short.includes('..') ||
      short.includes('@{') || short.includes('//') || /[\x00-\x20~^:?*[\]\\]/.test(short) ||
      short.split('/').some(s=>!s || s.startsWith('.') || s.endsWith('.lock'))) {
    throw new Error('Nome de ' + kind + ' inválido: ' + raw);
  }
  return prefix + short;
}
function versionInput(value) {
  const v=String(value).trim();
  if (/^[0-9a-f]{40}$/i.test(v)) return {version:v,versionType:'commit'};
  if (v.startsWith('refs/tags/')) return {version:v.slice(10),versionType:'tag'};
  if (v.startsWith('refs/heads/')) return {version:v.slice(11),versionType:'branch'};
  if (v.startsWith('tag:')) return {version:v.slice(4),versionType:'tag'};
  if (v.startsWith('branch:')) return {version:v.slice(7),versionType:'branch'};
  throw new Error('Use SHA completo, refs/tags/NOME, refs/heads/NOME, tag:NOME ou branch:NOME.');
}
const sha = v => /^[a-f0-9]{40}$/i.test(String(v||''));
function tagFromRelease(value, search, flags, replacement) {
  const original=String(value||'').trim();
  if (!original) throw new Error('Nome da release não encontrado. Informe tagName.');
  if (search) {
    if (search.length > 300 || flags.length > 5 || !/^[gimsuy]*$/.test(flags)) {
      throw new Error('Expressão regular/flags inválidos.');
    }
    const regex=new RegExp(search, flags);
    if (!regex.test(original)) throw new Error('O nome da release não corresponde a searchRegex.');
    return original.replace(new RegExp(search, flags), replacement);
  }
  return original.replace(/\s+/g,'-');
}
module.exports={input,required,yes,number,variable,issue,finish,save,refName,versionInput,sha,tagFromRelease};
