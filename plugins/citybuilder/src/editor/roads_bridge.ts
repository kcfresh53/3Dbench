import { TERRAIN_PROVIDER } from '../../../roadscape/src/editor/terrain_provider';
import type { TerrainProvider } from '../../../roadscape/src/editor/terrain_provider';
import { terrainStructure } from '../../../roadscape/src/core/terrain_context';
import { hasNetwork, readStoredDocument, emptyDocument } from '../../../roadscape/src/editor/document';
import { migrateLegacyRoad } from '../../../roadscape/src/editor/migrate';
import { readNetwork } from '../../../roadscape/src/editor/network_mesh';
import type { RoadDocument, RoadNetwork } from '../../../roadscape/src/core/model';
import { mergeRoadSets, roadSetFromNetwork } from '../core/roads/corridor';
import type { RoadSet } from '../core/roads/corridor';
import type { CityState } from '../core/city/state';
import type { Vec3 } from '../core/types';

/** Reads every Roadscape network in the open project and expresses it in city metres. */
export class RoadBridge {
	private provider: TerrainProvider | null = null;
	connect(getState:()=>CityState|null, revision:()=>number):void {
		this.provider=(mesh)=>{
			const state=getState(); if(!state)return undefined;
			mesh.mesh.updateWorldMatrix(true,false);
			const matrix=mesh.mesh.matrixWorld.clone(), inverse=matrix.clone().invert(), unit=state.settings.unitsPerMeter;
			const toCity=(p:Vec3):Vec3=>{const v=new THREE.Vector3(...p).applyMatrix4(matrix);return [v.x/unit,v.y/unit,v.z/unit];};
			const ground=(x:number,z:number)=>state.terrain.containsWorld(x,z)?state.terrain.sample(x,z):NaN;
			return {revision:`${Project.uuid}:${revision()}:${matrix.elements.join(',')}`,groundAt:(x,z)=>{
				const p=toCity([x,0,z]);const h=ground(p[0],p[2]);
				return new THREE.Vector3(p[0]*unit,h*unit,p[2]*unit).applyMatrix4(inverse).y;
			},autoStructure:points=>terrainStructure(points.map(toCity),ground,{
				waterLevel:state.settings.waterLevel,gapHeight:state.settings.conform.groundTolerance,
				minSpan:state.settings.conform.bridgeSpan,autoBridges:state.settings.conform.autoBridges})};
		};
		(globalThis as unknown as Record<symbol,TerrainProvider>)[TERRAIN_PROVIDER]=this.provider;
	}
	dispose():void {
		const registry=globalThis as unknown as Record<symbol,TerrainProvider>;
		if(registry[TERRAIN_PROVIDER]===this.provider)delete registry[TERRAIN_PROVIDER];
		Blockbench.dispatchEvent('citybuilder_terrain_changed', {});
	}
	meshes(): Mesh[] {
		return Mesh.all.filter(hasNetwork);
	}

	/** Changes whenever a road is added, moved, restyled or the mesh is transformed. A hash, so checking is cheap. */
	signature(unitsPerMeter: number): string {
		let h: number = 2166136261;
		const mix = (n: number): void => {
			h = Math.imul(h ^ (n | 0), 16777619);
		};
		const text = (t: string): void => {
			for (let i: number = 0; i < t.length; i++) mix(t.charCodeAt(i));
		};
		mix(Math.round(unitsPerMeter * 1000));
		for (const mesh of this.meshes()) {
			mesh.mesh.updateWorldMatrix(true, false);
			for (const key in mesh.vertices) {
				text(key);
				const v: ArrayVector3 = mesh.vertices[key];
				mix(Math.round(v[0] * 1000));
				mix(Math.round(v[1] * 1000));
				mix(Math.round(v[2] * 1000));
			}
			for (const face of Object.values(mesh.faces)) if (face.vertices.length === 2) text(face.vertices.join('|'));
			text((mesh as unknown as Record<string, string>)['roadscape_net'] ?? '');
			for (const e of mesh.mesh.matrixWorld.elements) mix(Math.round(e * 1000));
		}
		return h.toString(36);
	}

	collect(state: CityState, unitsPerMeter: number): RoadSet {
		const sets: RoadSet[] = [];
		const tmp: THREE.Vector3 = new THREE.Vector3();
		for (const mesh of this.meshes()) {
			const doc: RoadDocument = readStoredDocument(mesh) ?? migrateLegacyRoad(mesh) ?? emptyDocument();
			const network: RoadNetwork = readNetwork(mesh, doc);
			mesh.mesh.updateWorldMatrix(true, false);
			const matrix: THREE.Matrix4 = mesh.mesh.matrixWorld;
			const scale: THREE.Vector3 = mesh.mesh.getWorldScale(new THREE.Vector3());
			const meanScale: number = (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3;
			sets.push(
				roadSetFromNetwork(network, {
					toCity: (p: Vec3): Vec3 => {
						tmp.set(p[0], p[1], p[2]).applyMatrix4(matrix);
						return [tmp.x / unitsPerMeter, tmp.y / unitsPerMeter, tmp.z / unitsPerMeter];
					},
					lengthScale: (network.settings.unitsPerMeter * meanScale) / unitsPerMeter,
					sampleSpacing: 3,
					waterLevel: state.settings.waterLevel,
					autoBridges: state.settings.conform.autoBridges,
					bridgeSpan: state.settings.conform.bridgeSpan,
					groundTolerance: state.settings.conform.groundTolerance,
					terrainHeight: (x: number, z: number): number => state.terrain.containsWorld(x, z) ? state.terrain.sample(x, z) : NaN,
				}),
			);
		}
		return mergeRoadSets(sets);
	}

	/**
	 * Moves every road point onto the natural terrain so roads follow the landscape instead of the
	 * landscape being cut for them. One undo step.
	 */
	drapeOnTerrain(state: CityState, unitsPerMeter: number, lift: number): number {
		const meshes: Mesh[] = this.meshes();
		if (meshes.length === 0) return 0;
		Undo.initEdit({ elements: meshes.slice() } as never);
		const world: THREE.Vector3 = new THREE.Vector3();
		let moved: number = 0;
		for (const mesh of meshes) {
			mesh.mesh.updateWorldMatrix(true, false);
			const matrix: THREE.Matrix4 = mesh.mesh.matrixWorld;
			const inverse: THREE.Matrix4 = matrix.clone().invert();
			for (const key of Object.keys(mesh.vertices)) {
				const v: ArrayVector3 = mesh.vertices[key];
				world.set(v[0], v[1], v[2]).applyMatrix4(matrix);
				const ground: number = state.terrain.sample(world.x / unitsPerMeter, world.z / unitsPerMeter);
				world.y = (ground + lift) * unitsPerMeter;
				world.applyMatrix4(inverse);
				mesh.vertices[key] = [world.x, world.y, world.z];
				moved++;
			}
		}
		Undo.finishEdit('Drape roads on terrain', { elements: meshes } as never);
		Canvas.updateView({ elements: meshes, element_aspects: { geometry: true, faces: true }, selection: true } as never);
		return moved;
	}
}
