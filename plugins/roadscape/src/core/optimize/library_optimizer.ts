import type { PropMesh, Vec3 } from '../types';
import { optimizeMesh } from './mesh_optimizer';
import type { OptimizeOptions, OptimizeReport } from './mesh_optimizer';
import { cullHiddenFaces } from './visibility_cull';
import type { CullOptions } from './visibility_cull';

/**
 * Per-prop optimisation recipe. A prop is optimised once, offline, and ships as a single model:
 * there are no game/detail tiers at runtime. Tolerances are in metres.
 */
export interface PropRecipe {
	/** Rotation about +Y, radians, applied first so every prop shares one orientation convention. */
	yaw?: number;
	cull: Partial<CullOptions>;
	optimize: Partial<OptimizeOptions>;
}

export const PROP_RECIPES: Record<string, PropRecipe> = {
	'Jet Fan': {
		yaw: Math.PI / 2,
		cull: { minViews: 24, hemisphere: 'down', transparent: ['Tunnel Vent Grid', 'Tunnel Vent Circle'] },
		optimize: { maxError: 0.012, targetTriangles: 300, hardMaxError: 0.14, dropComponentSize: 0.03 },
	},
	'RSEA Env Streetlight': {
		cull: { minViews: 4, hemisphere: 'up' },
		optimize: { maxError: 0.02, targetTriangles: 150, hardMaxError: 0.08, dropComponentSize: 0.02 },
	},
	'Jersey Barrier Concrete Grey Middle': {
		yaw: Math.PI / 2,
		cull: { minViews: 4, hemisphere: 'up' },
		optimize: { maxError: 0.01, targetTriangles: 40, hardMaxError: 0.04 },
	},
	'RSEA Rock Small': {
		cull: { minViews: 3, hemisphere: 'up' },
		optimize: { maxError: 0.004, targetTriangles: 80, hardMaxError: 0.03 },
	},
	'Bridge Pole Baked': {
		cull: { minViews: 4, hemisphere: 'up' },
		optimize: { maxError: 0.01, targetTriangles: 24, hardMaxError: 0.05 },
	},
	'Reshiba Lamp': {
		cull: { minViews: 3, hemisphere: 'down' },
		optimize: { maxError: 0.006, targetTriangles: 30, hardMaxError: 0.04 },
	},
	'Guardrail Poles': {
		cull: { minViews: 2, hemisphere: 'up' },
		optimize: { maxError: 0.006, targetTriangles: 12, hardMaxError: 0.03 },
	},
	'Raised Pavement Marker': {
		cull: { minViews: 2, hemisphere: 'up' },
		optimize: { maxError: 0.004, targetTriangles: 12, hardMaxError: 0.02 },
	},
};

const FALLBACK_RECIPE: PropRecipe = { cull: { minViews: 2, hemisphere: 'up' }, optimize: { maxError: 0.008 } };

export interface PropReport extends OptimizeReport {
	name: string;
	culledFaces: number;
}

export function optimizeLibraryProps(source: Record<string, PropMesh>): { props: Record<string, PropMesh>; reports: PropReport[] } {
	const props: Record<string, PropMesh> = {};
	const reports: PropReport[] = [];
	for (const [name, mesh] of Object.entries(source)) {
		const recipe: PropRecipe = PROP_RECIPES[name] ?? FALLBACK_RECIPE;
		const oriented: PropMesh = recipe.yaw ? rotateMesh(mesh, recipe.yaw) : mesh;
		const culled: { mesh: PropMesh; removed: number } = cullHiddenFaces(oriented, recipe.cull);
		const result: { mesh: PropMesh; report: OptimizeReport } = optimizeMesh(culled.mesh, recipe.optimize);
		props[name] = result.mesh;
		reports.push({ ...result.report, trianglesBefore: triangles(mesh), name, culledFaces: culled.removed });
	}
	return { props, reports };
}

function triangles(mesh: PropMesh): number {
	let total: number = 0;
	for (const face of mesh.faces) total += face.indices.length - 2;
	return total;
}

function rotateMesh(mesh: PropMesh, yaw: number): PropMesh {
	const c: number = Math.cos(yaw);
	const s: number = Math.sin(yaw);
	return {
		positions: mesh.positions.map((p: Vec3): Vec3 => [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c]),
		faces: mesh.faces,
	};
}
