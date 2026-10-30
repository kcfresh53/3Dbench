import type { Plate } from './library';
import { sampleInto } from './library';
import type { MaterialChannel } from './material_resources';

/** Integer-valued float arithmetic also works in GLSL ES 1.0 without platform-dependent sine hashes. */
const mod=(x:number,n:number):number=>((x%n)+n)%n;
const scratch=new Float64Array(3);
const means=new WeakMap<Plate,Float64Array>();
export const STOCHASTIC_SCALE=.75;
export function sampleStochastic(p:Plate,u:number,v:number,channel:MaterialChannel,out:Float64Array,seed:number):void {
	if(p.w<=4){sampleInto(p,u,v,true,out);return;}
	const qx=(u-v*.57735026919)*STOCHASTIC_SCALE,qy=v*1.15470053838*STOCHASTIC_SCALE;
	const ix=Math.floor(qx),iy=Math.floor(qy),fx=qx-ix,fy=qy-iy,upper=fx+fy>1;
	let w0=upper?fx+fy-1:1-fx-fy,w1=upper?1-fx:fx,w2=upper?1-fy:fy;
	w0=w0*w0*(3-2*w0);w1=w1*w1*(3-2*w1);w2=w2*w2*(3-2*w2);
	const sum=w0+w1+w2;out.fill(0);
	for(let i=0;i<3;i++) {
		const gx=ix+(i===0?(upper?1:0):i===1?(upper?0:1):(upper?1:0));
		const gy=iy+(i===0?(upper?1:0):i===1?(upper?1:0):(upper?0:1));
		const n=mod(mod(gx,4093)*37+mod(gy,4093)*57+mod(Math.floor(seed),4093)*17,4093),h=mod(n*n+19,4093),rotation=h%4;
		const a=rotation===0?u:rotation===1?-v:rotation===2?-u:v;
		const b=rotation===0?v:rotation===1?u:rotation===2?-v:-u;
		sampleInto(p,a+mod(h*127+13,4093)/4093,b+mod(h*269+47,4093)/4093,true,scratch);
		const w=(i===0?w0:i===1?w1:w2)/sum;
		if(channel==='normal') {
			const nx=scratch[0]/127.5-1,ny=scratch[1]/127.5-1;
			out[0]+=(rotation===0?nx:rotation===1?ny:rotation===2?-nx:-ny)*w;
			out[1]+=(rotation===0?ny:rotation===1?-nx:rotation===2?-ny:nx)*w;
			out[2]+=(scratch[2]/127.5-1)*w;
		} else for(let k=0;k<3;k++)out[k]+=scratch[k]*w;
	}
	if(channel==='normal') {
		const deviation=Math.sqrt((w0*w0+w1*w1+w2*w2)/(sum*sum));
		out[0]/=deviation;out[1]/=deviation;
		const length=Math.hypot(out[0],out[1],out[2])||1;
		for(let k=0;k<3;k++)out[k]=(out[k]/length+1)*127.5;
	} else if(channel==='albedo') {
		let mean=means.get(p);
		if(!mean){mean=new Float64Array(3);for(let i=0;i<p.data.length;i++)mean[i%3]+=p.data[i]/(p.w*p.h);means.set(p,mean);}
		const deviation=Math.sqrt((w0*w0+w1*w1+w2*w2)/(sum*sum));
		for(let k=0;k<3;k++)out[k]=Math.max(0,Math.min(255,mean[k]+(out[k]-mean[k])/deviation));
	}
}

/** Shared with the live material and exported verbatim for engine terrain shaders. kind: 0 albedo, 1 normal, 2 ORM. */
export const STOCHASTIC_GLSL = `
uniform float cityStochasticSeed;
uniform vec3 cityStochasticAlbedoMean;
float cityHash(vec2 cell) {
 float n=mod(mod(cell.x,4093.0)*37.0+mod(cell.y,4093.0)*57.0+mod(floor(cityStochasticSeed),4093.0)*17.0,4093.0);
 return mod(n*n+19.0,4093.0);
}
vec4 citySampleTile(sampler2D tex,vec2 uv,vec2 cell,int kind) {
 float h=cityHash(cell),r=mod(h,4.0);
 vec2 p=r<.5?uv:r<1.5?vec2(-uv.y,uv.x):r<2.5?-uv:vec2(uv.y,-uv.x);
 p+=vec2(mod(h*127.0+13.0,4093.0),mod(h*269.0+47.0,4093.0))/4093.0;
 vec4 s=texture2D(tex,p);
 if(kind==0) return mapTexelToLinear(s);
 if(kind==1) {
  s.xyz=s.xyz*2.0-1.0;
  s.xy=r<.5?s.xy:r<1.5?vec2(s.y,-s.x):r<2.5?-s.xy:vec2(-s.y,s.x);
 }
 return s;
}
vec4 cityStochasticSample(sampler2D tex,vec2 uv,int kind) {
 vec2 q=vec2(uv.x-uv.y*.57735026919,uv.y*1.15470053838)*.75;
 vec2 cell=floor(q),f=fract(q);vec3 w;vec2 a,b,c;
 if(f.x+f.y>1.0) {w=vec3(f.x+f.y-1.0,1.0-f.x,1.0-f.y);a=cell+1.0;b=cell+vec2(0.0,1.0);c=cell+vec2(1.0,0.0);}
 else {w=vec3(1.0-f.x-f.y,f.x,f.y);a=cell;b=cell+vec2(1.0,0.0);c=cell+vec2(0.0,1.0);}
 w=w*w*(3.0-2.0*w);w/=w.x+w.y+w.z;
 vec4 s=citySampleTile(tex,uv,a,kind)*w.x+citySampleTile(tex,uv,b,kind)*w.y+citySampleTile(tex,uv,c,kind)*w.z;
 float deviation=sqrt(dot(w,w));
 if(kind==0)s.rgb=max(vec3(0.0),cityStochasticAlbedoMean+(s.rgb-cityStochasticAlbedoMean)/deviation);
 if(kind==1){s.xy/=deviation;s.xyz=normalize(s.xyz)*.5+.5;}
 return s;
}
`;
