'use strict';
require('esbuild').buildSync({entryPoints:['src/plugin.cjs'],bundle:true,platform:'node',format:'cjs',target:'es2020',external:['obsidian'],supported:{'template-literal':false},outfile:'main.js',banner:{js:'/* Generated from src/plugin.cjs with npm run build. Do not edit directly. */'},logLevel:'info'});
