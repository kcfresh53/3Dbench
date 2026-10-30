import type { Raster } from './raster';

function crc32(data:Uint8Array):number {
	let crc=0xffffffff;
	for(const value of data) {crc^=value;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
	return (crc^0xffffffff)>>>0;
}
function chunk(type:string,data:Uint8Array):Uint8Array {
	const out=new Uint8Array(data.length+12), view=new DataView(out.buffer);
	view.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);
	view.setUint32(out.length-4,crc32(out.subarray(4,out.length-4)));return out;
}

/** Canvas premultiplies RGB by alpha, corrupting packed blend weights. Encode data maps directly. */
export function dataRasterPng(raster:Raster):Uint8Array {
	const rows=new Uint8Array((raster.width*4+1)*raster.height);
	for(let y=0;y<raster.height;y++)rows.set(raster.data.subarray(y*raster.width*4,(y+1)*raster.width*4),y*(raster.width*4+1)+1);
	const proc=(globalThis as unknown as {process?:{getBuiltinModule?:(id:string)=>unknown}}).process;
	const zlib=(proc?.getBuiltinModule?.('node:zlib')??require('node:zlib')) as {deflateSync(data:Uint8Array):Uint8Array};
	const header=new Uint8Array(13), view=new DataView(header.buffer);
	view.setUint32(0,raster.width);view.setUint32(4,raster.height);header[8]=8;header[9]=6;
	const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',new Uint8Array())];
	const out=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));let offset=0;
	for(const part of parts){out.set(part,offset);offset+=part.length;}return out;
}
