import {mkdir,writeFile} from 'node:fs/promises';
import {waterWidgetPreview} from '../src/water-widget-preview.js';
import {WATER_WIDGET_HTML} from '../src/water-widget-html.js';
import {deflateSync} from 'node:zlib';
await mkdir('outputs',{recursive:true});
for(const [name,options] of Object.entries({light:{},dark:{dark:true},off:{kind:'off'},unknown:{kind:'unknown'},tomorrow:{selected:1}})){
  await writeFile(`outputs/water-widget-${name}.html`,waterWidgetPreview(options));
}
console.log('Water widget previews saved to outputs/ (demonstration data only).');
console.log(`HTML: ${Buffer.byteLength(WATER_WIDGET_HTML)} bytes; zlib: ${deflateSync(WATER_WIDGET_HTML,{level:9}).byteLength}/4096 bytes.`);
