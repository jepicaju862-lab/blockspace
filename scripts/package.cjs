'use strict';
const fs=require('node:fs');
const {zipArchive}=require('../src/export.cjs');
const id=require('../manifest.json').id;
fs.mkdirSync('dist',{recursive:true});
const entries=['main.js','manifest.json','styles.css','LICENSE','README.md'].map(name=>({name:`${id}/${name}`,bytes:fs.readFileSync(name)}));
const output=`dist/${id}-english.zip`;
fs.writeFileSync(output,zipArchive(entries));
console.log(output);
