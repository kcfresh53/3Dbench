import type { ViewContext } from './view';
import { terrainLayers } from '../../core/terrain/layers';
import { materialInfo, materialPlate } from '../../texture/ambientcg';
import type { MaterialId, MaterialChannel } from '../../texture/ambientcg';
import { terrainTint } from '../../texture/terrain_tiles';
import type { SurfaceName } from '../../core/terrain/surfaces';
import { mappedTexture } from './gl';
import { Raster } from '../../core/raster';
import { STOCHASTIC_GLSL } from '../../texture/stochastic';

/** World-scale PBR tiles, blended independently of the overview used by the water preview.
 * Filtered 1K GPU mips retain hundreds of texels/metre near the camera; game packages keep 4K originals.
 */
export class TerrainMaterials {
	private sources = new Map<string,THREE.DataTexture>();
	private masks: THREE.Texture[] = [];
	private materials: THREE.MeshStandardMaterial[] = [];
	private source(id:MaterialId, channel:MaterialChannel):THREE.DataTexture {
		const key=`${id}:${channel}`;
		let texture=this.sources.get(key);
		if(!texture) {
			const p=materialPlate(id,channel);
			texture=new THREE.DataTexture(p.data,p.w,p.h,THREE.RGBFormat);
			texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
			texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
			texture.generateMipmaps=true;texture.flipY=false;texture.anisotropy=16;
			if(channel==='albedo')texture.encoding=THREE.sRGBEncoding;
			texture.needsUpdate=true;this.sources.set(key,texture);
		}
		return texture;
	}
	build(ctx:ViewContext):THREE.MeshStandardMaterial[] {
		this.clear();
		const layers=terrainLayers(ctx.plan,ctx.state.settings);
		const first=layers.files[0].raster;
		const sum=new Float32Array(first.width*first.height);
		for(const entry of layers.manifest.entries) {
			const alpha=new Raster(first.width,first.height);
			const weights=layers.files[entry.mask].raster.data;
			let active=false;
			for(let i=0;i<sum.length;i++) {
				const w=weights[i*4+entry.channel];sum[i]+=w;
				const a=sum[i]>0?w/sum[i]*255:0;
				alpha.data[i*4+1]=a;alpha.data[i*4+3]=255;
				if(w>0)active=true;
			}
			if(!active)continue;
			const mask=mappedTexture(alpha,{srgb:false,anisotropy:16});this.masks.push(mask);
			const id=entry.material as MaterialId, orm=this.source(id,'orm');
			const m=new THREE.MeshStandardMaterial({map:this.source(id,'albedo'),normalMap:this.source(id,'normal'),
				roughnessMap:orm,metalnessMap:orm,aoMap:orm,roughness:entry.surface==='mud'?.62:1,metalness:1,
				alphaMap:mask,transparent:true,alphaTest:.001,depthWrite:false});
			const tint=terrainTint[entry.surface as SurfaceName]??[1,1,1];m.color.setRGB(...tint);
			const metres=materialInfo(id).metres;
			m.onBeforeCompile=shader=>{
				shader.uniforms.cityStochasticSeed={value:((Math.floor(ctx.state.settings.seed)%4093)+4093)%4093};
				shader.uniforms.cityStochasticAlbedoMean={value:new THREE.Vector3().fromArray(materialInfo(id).albedoMeanLinear)};
				const uv=`position.xz / vec2(${metres[0].toFixed(4)},${metres[1].toFixed(4)})`;
				shader.vertexShader='varying vec2 vTerrainMaskUv;\n'+shader.vertexShader;
				shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>\nvTerrainMaskUv = uv;\nvUv = ${uv};`)
					.replace('#include <uv2_vertex>',`#include <uv2_vertex>\n#if defined(USE_LIGHTMAP) || defined(USE_AOMAP)\nvUv2 = ${uv};\n#endif`);
				shader.fragmentShader='varying vec2 vTerrainMaskUv;\n'+STOCHASTIC_GLSL+shader.fragmentShader;
				shader.fragmentShader=shader.fragmentShader.replace('#include <alphamap_fragment>','diffuseColor.a *= texture2D(alphaMap, vTerrainMaskUv).g;');
				shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','diffuseColor *= cityStochasticSample(map,vUv,0);');
				for(const [chunk,sampler,uv,kind] of [['roughnessmap_fragment','roughnessMap','vUv',2],['metalnessmap_fragment','metalnessMap','vUv',2],['aomap_fragment','aoMap','vUv2',2],['normal_fragment_maps','normalMap','vUv',1]] as const) {
					shader.fragmentShader=shader.fragmentShader.replace(`#include <${chunk}>`,THREE.ShaderChunk[chunk].replaceAll(`texture2D( ${sampler}, ${uv} )`,`cityStochasticSample(${sampler},${uv},${kind})`));
				}
			};
			m.customProgramCacheKey=()=>`city-terrain-stochastic-v1-${id}`;
			this.materials.push(m);
		}
		return this.materials;
	}
	clear():void {for(const m of this.materials)m.dispose();for(const t of this.masks)t.dispose();this.materials=[];this.masks=[];}
	dispose():void {this.clear();for(const t of this.sources.values())t.dispose();this.sources.clear();}
}
