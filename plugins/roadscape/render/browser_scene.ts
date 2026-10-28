import { generateNetwork } from '../src/core/generate';
import type { GenerateResult } from '../src/core/generate';
import { addNode, addSegment, createNetwork } from '../src/core/network';
import type { RoadNetwork } from '../src/core/model';
import { ProceduralTreeProvider } from '../src/editor/tree_provider';
import { makeRoadBody, MaterialPool } from '../src/editor/live_render';
import type { RoadLibrary } from '../src/core/library_types';

declare const THREE: typeof import('three');
declare const LIBRARY: RoadLibrary;

function avenue(): RoadNetwork {
	const n: RoadNetwork = createNetwork({ defaultProfile: 'tree_street' });
	const pts: Array<[string, [number, number, number]]> = [['a', [-90, 0, 0]], ['b', [-30, 0, 5]], ['c', [20, 0, -10]], ['d', [90, 0, 0]], ['e', [-10, 0, 70]], ['f', [-40, 0, -70]]];
	for (const [id, p] of pts) addNode(n, id, p);
	addSegment(n, 'a', 'b');
	addSegment(n, 'b', 'c');
	addSegment(n, 'c', 'd');
	addSegment(n, 'b', 'e', { profile: 'street' });
	addSegment(n, 'b', 'f', { profile: 'country' });
	return n;
}

(async (): Promise<void> => {
	let ready: () => void = (): void => {};
	const trees: ProceduralTreeProvider = new ProceduralTreeProvider((): void => ready());
	const net: RoadNetwork = avenue();
	const context = { library: LIBRARY, trees };
	let result: GenerateResult = generateNetwork(net, context);
	for (let i: number = 0; i < 100 && result.report.treesPending; i++) {
		await new Promise<void>((r: () => void): void => {
			ready = r;
			setTimeout(r, 200);
		});
		result = generateNetwork(net, context);
	}
	const pool: MaterialPool = new MaterialPool(LIBRARY, (k: string) => trees.atlas(k), (): void => {});
	const renderer: THREE.WebGLRenderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement, antialias: true, preserveDrawingBuffer: true });
	renderer.setSize(1400, 700);
	renderer.setClearColor(0x8fb4d6);
	const scene: THREE.Scene = new THREE.Scene();
	// Textures load asynchronously; build the body once they have.
	const body: THREE.Group = makeRoadBody(result.parts, pool);
	scene.add(body);
	await new Promise<void>((r: () => void): void => void setTimeout(r, 800));
	const cam: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(40, 2, 0.1, 2000);
	cam.position.set(60, 80, 140);
	cam.lookAt(-10, 0, 10);
	renderer.render(scene, cam);
	(window as unknown as Record<string, unknown>).stats = { triangles: result.triangles, breakdown: result.breakdown, pending: result.report.treesPending };
	(window as unknown as Record<string, unknown>).done = true;
})();
