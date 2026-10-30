import packed from './ambientcg_data.json';
import metadata from './ambientcg_manifest.json';
import type { MaterialId, MaterialChannel } from './material_resources';
export { materialInfo, materialSource, MATERIAL_IDS } from './material_resources';
export type { MaterialId, MaterialChannel } from './material_resources';
import decodeJpeg from './vendor/jpeg_decoder.cjs';
import { sampleInto } from './library';
import type { Plate } from './library';

function bytes(base64: string): Uint8Array {
	return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}
const cache = new Map<string, Plate>();
/** Filtered CPU mip for overview bakes; original 4K maps also leave with the export. */
export function materialPlate(id: MaterialId, channel: MaterialChannel, pixelMetres: number = 0): Plate {
	const level = Math.max(0, Math.min(9, Math.floor(Math.log2(Math.max(1, pixelMetres * packed[id].mipWidth / metadata[id].metres[0])))));
	const key = `${id}:${channel}:${level}`;
	let image = cache.get(key);
	if (!image) {
		if(level===0) {
			const m = packed[id];
			const decoded = decodeJpeg(bytes(m.mip[channel]), { useTArray: true, formatAsRGBA: false });
			image = { w: decoded.width, h: decoded.height, c: 3, data: decoded.data };
		} else {
			const previous = materialPlate(id,channel,metadata[id].metres[0]/packed[id].mipWidth * 2**(level-1));
			const w=Math.max(1,previous.w>>1), h=Math.max(1,previous.h>>1), data=new Uint8Array(w*h*3);
			for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let k=0;k<3;k++) {
				let sum=0;
				for(let j=0;j<2;j++)for(let i=0;i<2;i++)sum+=previous.data[(Math.min(previous.h-1,y*2+j)*previous.w+Math.min(previous.w-1,x*2+i))*3+k];
				data[(y*w+x)*3+k]=Math.round(sum/4);
			}
			image={w,h,c:3,data};
		}
		cache.set(key, image);
	}
	return image;
}
/** World-space tiling supports negative coordinates and non-square sheets. */
export function sampleMaterial(id: MaterialId, channel: MaterialChannel, x: number, y: number, out: Float64Array, pixelMetres: number = 0): void {
	const m = metadata[id];
	sampleInto(materialPlate(id, channel, pixelMetres), x / m.metres[0], y / m.metres[1], true, out);
}
