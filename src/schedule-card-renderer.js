import {scheduleCardSvg} from './schedule-card.js';
import {Resvg} from '@cf-wasm/resvg/workerd';
import notoRegular from './assets/noto-sans-regular.bin';
import notoBold from './assets/noto-sans-bold.bin';

export async function renderScheduleCardPng(payload) {
  const renderer=await Resvg.async(scheduleCardSvg(payload),{
    fitTo:{mode:'width',value:1200},
    font:{
      fontBuffers:[notoRegular,notoBold]
        .map(buffer=>new Uint8Array(buffer)),
      defaultFontFamily:'Noto Sans',loadSystemFonts:false
    }
  });
  let rendered;
  let image;
  try {
    rendered=renderer.render();
    image=new Uint8Array(rendered.asPng());
  } finally {
    rendered?.free();
    renderer.free();
  }
  if(image.length<1000||image.length>10*1024*1024)throw new Error('Schedule card PNG size is invalid');
  return image;
}
