import type { Vec3 } from '../core/types';
import type { NetworkSettings, RoadNetwork, RoadProfile, SegmentData } from '../core/model';
import { GenerationCache, generateNetwork } from '../core/generate';
import type { GenerateResult } from '../core/generate';
import { applyDraft, counterIds, snapPoint } from '../core/network_edit';
import type { DraftAnchor, SnapResult } from '../core/network_edit';
import { createNetwork } from '../core/network';
import { distanceXZ } from '../core/vec';
import type { LiveRoads } from './live_manager';
import { disposeBody } from './live_render';
import { listen } from './events';
import type { Disposable } from './events';
import { selectMoveTool } from './bb_access';
import { hasNetwork } from './document';

export interface DrawOptions {
	/** Height of the drawing plane in model units. */
	height: number;
	/** Grid spacing in model units, 0 for none. */
	snap: number;
	/** Place points on the surface under the cursor instead of the drawing plane. */
	surface: boolean;
	/** Snap to existing road points and roads so new roads connect to them. */
	connect: boolean;
}

export interface DrawHost {
	manager: LiveRoads;
	options(): DrawOptions;
	/** Profile and flags for roads being drawn. */
	segmentData(): Partial<SegmentData>;
	/** Settings for a network created by this drawing. */
	newSettings(): Partial<NetworkSettings>;
	/** Project profiles edited before any road existed. */
	draftProfiles(): Map<string, RoadProfile>;
	status(message: string): void;
}

const MAX_POINTS: number = 128;
const GHOST_NODE_LIMIT: number = 120;
const SNAP_PIXELS: number = 0.022;

/** Click-to-draw road tool with snapping, closed loops and a ghost of the result. */
export class DrawTool {
	readonly tool: Tool;
	private anchors: DraftAnchor[] = [];
	private hover: DraftAnchor | null = null;
	private owner: typeof Project | null = null;
	private ghost: THREE.Group | null = null;
	private timer: number | null = null;
	private readonly cache: GenerationCache = new GenerationCache();
	private readonly lineMaterial: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({ color: 0x54c5ff, depthTest: false });
	private readonly pointMaterial: THREE.PointsMaterial = new THREE.PointsMaterial({ color: 0xffcf70, size: 8, sizeAttenuation: false, depthTest: false });
	private readonly snapMaterial: THREE.PointsMaterial = new THREE.PointsMaterial({ color: 0x7dff9a, size: 13, sizeAttenuation: false, depthTest: false });
	private readonly subscriptions: Disposable[] = [];
	private readonly onMove: (event: PointerEvent) => void;
	private readonly onKey: (event: KeyboardEvent) => void;
	private disposed: boolean = false;

	constructor(private readonly host: DrawHost) {
		this.onMove = (event: PointerEvent): void => this.pointerMove(event);
		this.onKey = (event: KeyboardEvent): void => this.keyDown(event);
		this.tool = new Tool('roadscape_draw', {
			name: 'Draw Road',
			description: 'Click points in the viewport. Snaps to roads and points; Enter finishes, Escape cancels',
			icon: 'add_road',
			category: 'tools',
			modes: ['edit'],
			condition: (): boolean => !!Project && !!Format.meshes,
			selectElements: false,
			transformerMode: 'hidden',
			cursor: 'crosshair',
			onSelect: (): void => {
				this.owner = Project;
				this.host.status('Click to place points. Shift locks an axis. Enter or double-click finishes; Esc cancels.');
			},
			onUnselect: (): void => this.reset(),
			onCanvasClick: (data: { event?: MouseEvent }): void => this.canvasClick(data.event),
			onCanvasRightClick: (): boolean => {
				this.finish();
				return false;
			},
		} as never) as Tool;
		document.addEventListener('pointermove', this.onMove);
		document.addEventListener('keydown', this.onKey, true);
		this.subscriptions.push(listen(Blockbench, 'unselect_project', (): void => this.reset()));
	}

	/** Starts drawing: clears the selection and activates the tool. */
	start(): void {
		this.reset();
		this.owner = Project;
		unselectAllElements();
		updateSelection();
		this.tool.select();
	}

	get active(): boolean {
		return Toolbox.selected === this.tool;
	}

	get pointCount(): number {
		return this.anchors.length;
	}

	cancel(): void {
		this.reset();
		if (this.active) selectMoveTool();
	}

	refresh(): void {
		this.showGhost();
	}

	private reset(): void {
		this.anchors = [];
		this.hover = null;
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		this.clearGhost();
	}

	private clearGhost(): void {
		disposeBody(this.ghost);
		this.ghost = null;
	}

	private networkForSnapping(): RoadNetwork | null {
		const target: Mesh | null = this.host.manager.target();
		return target && this.host.options().connect ? this.host.manager.networkOf(target) : null;
	}

	private radiusFor(preview: Preview, point: Vec3): number {
		const camera: THREE.Camera = preview.camera;
		const distance: number = camera.position.distanceTo(new THREE.Vector3(point[0], point[1], point[2]));
		const fov: number = (camera as THREE.PerspectiveCamera).fov ?? 40;
		const view: number = 2 * distance * Math.tan((fov * Math.PI) / 360);
		return Math.max(view * SNAP_PIXELS, 0.05);
	}

	private locate(event: PointerEvent | MouseEvent): { anchor: DraftAnchor; radius: number } | null {
		const preview: Preview | undefined = Preview.all.find((p: Preview): boolean => p.canvas === event.target);
		if (!preview) return null;
		Preview.selected = preview;
		const options: DrawOptions = this.host.options();
		let point: THREE.Vector3 | null = null;
		const hit = (preview as unknown as { raycast(e: MouseEvent): { intersects?: Array<{ point: THREE.Vector3 }>; element?: unknown } | null }).raycast(event);
		// Roads drawn earlier are not drawing surfaces; the plane (or other models) are.
		const onRoad: boolean = !!hit?.element && hit.element instanceof Mesh && hasNetwork(hit.element);
		if (options.surface && hit?.intersects?.[0] && !onRoad) point = hit.intersects[0].point.clone();
		else point = preview.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -Number(options.height || 0)), new THREE.Vector3());
		if (!point) return null;
		const grid: number = Number(options.snap) || 0;
		if (grid > 0) {
			point.x = Math.round(point.x / grid) * grid;
			point.z = Math.round(point.z / grid) * grid;
		}
		const last: DraftAnchor | undefined = this.anchors[this.anchors.length - 1];
		if (event.shiftKey && last) {
			if (Math.abs(point.x - last.position[0]) > Math.abs(point.z - last.position[2])) point.z = last.position[2];
			else point.x = last.position[0];
		}
		let position: Vec3 = [point.x, point.y, point.z];
		const radius: number = this.radiusFor(preview, position);
		const network: RoadNetwork | null = this.networkForSnapping();
		let snap: SnapResult = { snap: { type: 'free' }, position };
		if (network && !event.altKey) {
			snap = snapPoint(network, position, radius);
			if (snap.snap.type !== 'free') position = [snap.position[0], snap.position[1], snap.position[2]];
		}
		return { anchor: { position, snap: snap.snap }, radius };
	}

	private canvasClick(event: MouseEvent | undefined): void {
		if (!event || event.button > 0) return;
		const found: { anchor: DraftAnchor; radius: number } | null = this.locate(event);
		if (!found) return;
		if (event.detail >= 2 && this.anchors.length >= 2) {
			this.finish();
			return;
		}
		this.addAnchor(found.anchor, found.radius);
	}

	addAnchor(anchor: DraftAnchor, radius: number = 1): void {
		if (Project !== this.owner) throw new Error('The drawing project changed.');
		if (this.anchors.length >= MAX_POINTS) {
			this.host.status(`A single drawing supports up to ${MAX_POINTS} points. Press Enter to finish it.`);
			return;
		}
		const last: DraftAnchor | undefined = this.anchors[this.anchors.length - 1];
		if (last && distanceXZ(last.position, anchor.position) < 0.01) return;
		const first: DraftAnchor | undefined = this.anchors[0];
		if (first && this.anchors.length >= 3 && distanceXZ(first.position, anchor.position) <= radius) {
			this.finish(true, radius);
			return;
		}
		this.anchors.push(anchor);
		this.hover = null;
		this.showGhost();
	}

	/** Commits the drawing as one undo step and keeps the tool ready for the next road. */
	finish(closed: boolean = false, radius: number = 1): boolean {
		if (this.anchors.length < 2) {
			this.host.status('Click at least two points before finishing.');
			return false;
		}
		try {
			if (Project !== this.owner) throw new Error('The drawing project is no longer open.');
			const manager: LiveRoads = this.host.manager;
			const target: Mesh | null = manager.target();
			manager.commitDraft(target, this.anchors, this.host.segmentData(), closed, Math.max(radius, 0.05), this.host.newSettings(), this.host.draftProfiles());
			this.anchors = [];
			this.hover = null;
			this.clearGhost();
			this.host.status('Road added. Keep clicking to draw another, or press Esc to stop.');
			return true;
		} catch (error) {
			this.host.status((error as Error).message);
			console.error('Roadscape', error);
			return false;
		}
	}

	private pointerMove(event: PointerEvent): void {
		if (!this.active || !this.owner || this.disposed) return;
		const found: { anchor: DraftAnchor; radius: number } | null = this.locate(event);
		if (!found) return;
		this.hover = found.anchor;
		if (this.timer === null) this.timer = window.setTimeout((): void => this.showGhost(), 35);
	}

	private keyDown(event: KeyboardEvent): void {
		if (!this.active) return;
		const target: HTMLElement = event.target as HTMLElement;
		if (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable) return;
		if (!['Enter', 'Escape', 'Backspace'].includes(event.key)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (event.key === 'Enter') this.finish();
		else if (event.key === 'Backspace') {
			this.anchors.pop();
			this.showGhost();
		} else if (this.anchors.length > 0) {
			this.reset();
			this.host.status('Drawing cancelled. Press Esc again to stop drawing roads.');
		} else {
			this.cancel();
			this.host.status('Stopped drawing.');
		}
	}

	private showGhost(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		if (this.disposed || Project !== this.owner) return;
		const samples: DraftAnchor[] = [...this.anchors];
		if (this.hover) {
			const last: DraftAnchor | undefined = samples[samples.length - 1];
			if (!last || distanceXZ(last.position, this.hover.position) > 0.05) samples.push(this.hover);
		}
		this.clearGhost();
		if (samples.length === 0) return;
		const manager: LiveRoads = this.host.manager;
		const target: Mesh | null = manager.target();
		const group: THREE.Group = new THREE.Group();
		(group as unknown as { no_export: boolean }).no_export = true;
		(target?.mesh ?? scene).add(group);
		this.ghost = group;
		const points: THREE.Vector3[] = samples.map((a: DraftAnchor): THREE.Vector3 => new THREE.Vector3(...a.position));
		const geometry: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints(points);
		const line: THREE.Line = new THREE.Line(geometry, this.lineMaterial);
		line.renderOrder = 20;
		group.add(line);
		const dots: THREE.Points = new THREE.Points(geometry.clone(), this.pointMaterial);
		dots.renderOrder = 21;
		group.add(dots);
		if (this.hover && this.hover.snap.type !== 'free') {
			const mark: THREE.Points = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...this.hover.position)]), this.snapMaterial);
			mark.renderOrder = 22;
			group.add(mark);
		}
		for (const o of group.children) (o as unknown as { no_export: boolean }).no_export = true;
		if (samples.length < 2 || !manager.library) return;
		try {
			const base: RoadNetwork = target ? manager.networkOf(target) : createNetwork();
			if (base.nodes.size > GHOST_NODE_LIMIT) {
				this.host.status(`${this.anchors.length} points. Press Enter to finish.`);
				return;
			}
			const draft: RoadNetwork = applyDraft(base, samples, counterIds('~g'), this.host.segmentData(), false, this.radiusFor(Preview.selected, samples[0].position)).network;
			const result: GenerateResult = generateNetwork(draft, manager.context(), this.cache);
			const body: THREE.Group | null = manager.body(result);
			if (body) group.add(body);
			this.host.status(`${this.anchors.length} points · ${result.triangles.toLocaleString()} triangles in the network`);
		} catch (error) {
			this.host.status((error as Error).message);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.reset();
		for (const s of this.subscriptions) s.delete();
		document.removeEventListener('pointermove', this.onMove);
		document.removeEventListener('keydown', this.onKey, true);
		this.lineMaterial.dispose();
		this.pointMaterial.dispose();
		this.snapMaterial.dispose();
		if (this.active) selectMoveTool();
		this.tool.delete();
	}
}
