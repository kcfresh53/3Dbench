import type { Heightfield } from '../core/terrain/heightfield';
import { raycastHeightfield, raycastPlane } from '../core/terrain/ray';
import type { Vec3 } from '../core/types';

export interface CityHit {
	x: number;
	y: number;
	z: number;
}

/** Casts the pointer ray into the terrain. Coordinates are in city metres. */
export function pickCity(preview: Preview, event: MouseEvent, hf: Heightfield, unitsPerMeter: number, waterLevel: number): CityHit | null {
	const rect: DOMRect = preview.canvas.getBoundingClientRect();
	const ndc: THREE.Vector2 = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
	const caster: THREE.Raycaster = new THREE.Raycaster();
	caster.setFromCamera(ndc, preview.camera);
	const o: THREE.Vector3 = caster.ray.origin;
	const d: THREE.Vector3 = caster.ray.direction;
	const origin: Vec3 = [o.x / unitsPerMeter, o.y / unitsPerMeter, o.z / unitsPerMeter];
	const dir: Vec3 = [d.x, d.y, d.z];
	const hit = raycastHeightfield(hf, origin, dir);
	if (hit) return { x: hit.point[0], y: hit.point[1], z: hit.point[2] };
	const plane: Vec3 | null = raycastPlane(origin, dir, waterLevel);
	if (plane && hf.containsWorld(plane[0], plane[2])) return { x: plane[0], y: plane[1], z: plane[2] };
	return null;
}

export interface PointerHandler {
	/** Called while the pointer is over the terrain and no button is held. */
	hover(hit: CityHit | null, event: PointerEvent): void;
	down(hit: CityHit, event: PointerEvent): void;
	move(hit: CityHit, event: PointerEvent): void;
	up(event: PointerEvent): void;
	cancel(): void;
}

/**
 * Turns left-button drags on a preview into stroke callbacks while a tool is active. Right and
 * middle buttons still orbit and pan, because only the left button is intercepted.
 */
export class CanvasInput {
	private dragging: boolean = false;
	private disposed: boolean = false;
	private readonly onDown: (e: PointerEvent) => void;
	private readonly onMove: (e: PointerEvent) => void;
	private readonly onUp: (e: PointerEvent) => void;
	private readonly onKey: (e: KeyboardEvent) => void;

	constructor(
		private readonly isActive: () => boolean,
		private readonly context: () => { hf: Heightfield; unitsPerMeter: number; waterLevel: number } | null,
		private readonly handler: PointerHandler,
	) {
		this.onDown = (e: PointerEvent): void => this.down(e);
		this.onMove = (e: PointerEvent): void => this.move(e);
		this.onUp = (e: PointerEvent): void => this.up(e);
		this.onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape' && this.dragging) {
				this.dragging = false;
				this.handler.cancel();
			}
		};
		document.addEventListener('pointerdown', this.onDown, true);
		document.addEventListener('pointermove', this.onMove);
		document.addEventListener('pointerup', this.onUp, true);
		document.addEventListener('keydown', this.onKey, true);
	}

	private previewOf(event: Event): Preview | undefined {
		return Preview.all.find((p: Preview): boolean => p.canvas === event.target);
	}

	private down(e: PointerEvent): void {
		if (this.disposed || !this.isActive() || e.button !== 0) return;
		const preview: Preview | undefined = this.previewOf(e);
		const ctx = this.context();
		if (!preview || !ctx) return;
		Preview.selected = preview;
		e.stopPropagation();
		e.preventDefault();
		const hit: CityHit | null = pickCity(preview, e, ctx.hf, ctx.unitsPerMeter, ctx.waterLevel);
		if (!hit) return;
		this.dragging = true;
		this.handler.down(hit, e);
	}

	private move(e: PointerEvent): void {
		if (this.disposed || !this.isActive()) return;
		const preview: Preview | undefined = this.previewOf(e);
		const ctx = this.context();
		if (!ctx) return;
		if (!preview) {
			if (!this.dragging) this.handler.hover(null, e);
			return;
		}
		const hit: CityHit | null = pickCity(preview, e, ctx.hf, ctx.unitsPerMeter, ctx.waterLevel);
		if (this.dragging) {
			if (hit) this.handler.move(hit, e);
		} else {
			this.handler.hover(hit, e);
		}
	}

	private up(e: PointerEvent): void {
		if (!this.dragging) return;
		this.dragging = false;
		if (e.button === 0) e.stopPropagation();
		this.handler.up(e);
	}

	dispose(): void {
		this.disposed = true;
		document.removeEventListener('pointerdown', this.onDown, true);
		document.removeEventListener('pointermove', this.onMove);
		document.removeEventListener('pointerup', this.onUp, true);
		document.removeEventListener('keydown', this.onKey, true);
	}
}
