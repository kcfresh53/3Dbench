import type { Ctx2D, PixelRect } from './canvas_types';
import { Rng } from '../core/rng';
import { shade } from './color';

/** Ringed palm bark, rather than the vertical fissures of a hardwood trunk. */
export function paintPalmBark(ctx:Ctx2D,r:PixelRect,base:string,rng:Rng):void {
 ctx.fillStyle=base;ctx.fillRect(r.x,r.y,r.w,r.h);
 const band=r.h/44;
 for(let row=0;row<44;row++) {
  const y=r.y+row*band;
  ctx.fillStyle=shade(base,rng.range(0.85,1.13));
  ctx.fillRect(r.x,y,r.w,band);
  ctx.fillStyle=shade(base,0.48);
  ctx.fillRect(r.x,y,r.w,Math.max(1,band*0.13));
  ctx.fillStyle=shade(base,1.22);
  ctx.fillRect(r.x,y+band*0.15,r.w,Math.max(1,band*0.08));
 }
 // Fine fibers break up the otherwise perfectly smooth ring bands.
 for(let i=0;i<Math.round(r.w*2);i++) {
  ctx.fillStyle=shade(base,rng.range(0.65,1.2));
  ctx.globalAlpha=0.25;
  ctx.fillRect(r.x+rng.next()*r.w,r.y+rng.next()*r.h,Math.max(1,r.w/350),r.h*rng.range(0.002,0.015));
 }
 ctx.globalAlpha=1;
}

/** The leaflet mesh supplies its silhouette; this fills only its sampled atlas tile. */
export function paintPalmLeaf(ctx:Ctx2D,r:PixelRect,a:string,b:string):void {
 const gradient=ctx.createLinearGradient(r.x,r.y,r.x+r.w,r.y);
 gradient.addColorStop(0,shade(a,0.72));gradient.addColorStop(0.45,b);
 gradient.addColorStop(0.52,a);gradient.addColorStop(1,shade(a,0.85));
 ctx.fillStyle=gradient;ctx.fillRect(r.x,r.y,r.w,r.h);
 ctx.strokeStyle=shade(b,1.12);ctx.lineWidth=Math.max(1,r.w/300);
 for(let i=0;i<35;i++) {
  const y=r.y+r.h*i/35;
  ctx.beginPath();ctx.moveTo(r.x,y);ctx.lineTo(r.x+r.w/2,y+r.h*0.08);ctx.lineTo(r.x+r.w,y);ctx.stroke();
 }
}
