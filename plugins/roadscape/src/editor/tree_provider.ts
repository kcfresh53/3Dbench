import type { MeshData, MeshFaceData, PresetName, TreeLod, TreeParams, Vec3 as TreeVec3 } from '../../../procedural_trees/src/core/types';
import { fitToBudget } from '../../../procedural_trees/src/core/tree_generator';
import { mergeMeshData } from '../../../procedural_trees/src/core/mesh_builder';
import { paintAtlas } from '../../../procedural_trees/src/texture/atlas';
import { PRESET_NAMES, presetParams } from '../../../procedural_trees/src/ui/presets';
import type { PartFace, TreeSpecLike, Vec3 } from '../core/types';
import type { TreeAsset, TreeProvider } from '../core/context';

export interface TreeAtlas {
	dataUrl: string;
	size: number;
}

interface Entry {
	assets: TreeAsset[];
	failed: boolean;
}

const MAX_VARIANTS: number = 8;
const ATLAS_SIZE: number = 256;

function paramsFor(spec: TreeSpecLike, unit: number, variant: number): TreeParams {
	const preset: PresetName = (PRESET_NAMES as string[]).includes(spec.preset) ? (spec.preset as PresetName) : 'oak_stylized';
	return {
		...presetParams(preset),
		height: spec.height * unit,
		maxTriangles: Math.max(12, Math.round(spec.maxTriangles)),
		seed: spec.seed + variant * 977,
		lodCount: 1,
		spreadLods: false,
		separateFoliage: false,
		textureSize: ATLAS_SIZE,
		useCustomTextures: false,
		useBundledTextures: false,
		barkImage: '',
		leafImage: '',
	};
}

function toAsset(key: string, lod: TreeLod, height: number): TreeAsset {
	const merged: MeshData = mergeMeshData(lod.trunk, lod.foliage);
	const faces: PartFace[] = merged.faces.map((f: MeshFaceData): PartFace => ({ indices: f.indices.slice(), uvs: f.uvs.map((uv): [number, number] => [uv[0], uv[1]]) }));
	const positions: Vec3[] = merged.positions.map((p: TreeVec3): Vec3 => [p[0], p[1], p[2]]);
	return { key, positions, faces, height, triangles: lod.triangles };
}

/**
 * Builds road-side trees with the Procedural Trees generator. The first request for a tree style
 * starts the work; until its atlas is painted the provider reports nothing, then `revision` moves
 * on and `onReady` fires so roads rebuild with real trees.
 */
export class ProceduralTreeProvider implements TreeProvider {
	revision: number = 0;
	private readonly entries: Map<string, Entry> = new Map();
	private readonly pending: Set<string> = new Set();
	private readonly atlases: Map<string, TreeAtlas> = new Map();
	private disposed: boolean = false;

	constructor(private readonly onReady: () => void) {}

	assets(spec: TreeSpecLike, unit: number): TreeAsset[] {
		const id: string = JSON.stringify([spec.preset, spec.height, spec.variants, spec.maxTriangles, spec.seed, unit]);
		const entry: Entry | undefined = this.entries.get(id);
		if (entry) return entry.assets;
		if (!this.pending.has(id) && !this.disposed) {
			this.pending.add(id);
			void this.build(id, spec, unit);
		}
		return [];
	}

	atlas(key: string): TreeAtlas | undefined {
		return this.atlases.get(key);
	}

	private async build(id: string, spec: TreeSpecLike, unit: number): Promise<void> {
		try {
			const variants: number = Math.max(1, Math.min(MAX_VARIANTS, Math.round(spec.variants)));
			const base: TreeParams = paramsFor(spec, unit, 0);
			const dataUrl: string = await paintAtlas(base);
			if (this.disposed) return;
			const key: string = `tree:${id}`;
			this.atlases.set(key, { dataUrl, size: base.textureSize });
			const assets: TreeAsset[] = [];
			for (let v: number = 0; v < variants; v++) {
				const params: TreeParams = paramsFor(spec, unit, v);
				assets.push(toAsset(key, fitToBudget(params, params.maxTriangles), params.height));
			}
			this.entries.set(id, { assets, failed: false });
		} catch (error) {
			console.error('Roadscape tree generation failed', error);
			this.entries.set(id, { assets: [], failed: true });
		} finally {
			this.pending.delete(id);
			this.revision++;
			if (!this.disposed) this.onReady();
		}
	}

	dispose(): void {
		this.disposed = true;
		this.entries.clear();
		this.atlases.clear();
	}
}
