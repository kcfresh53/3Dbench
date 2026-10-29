/** A sample of a traced street. */
export interface StreamPoint {
	x: number;
	z: number;
	line: number;
	index: number;
}

/** Uniform grid for quick "is anything within r of here" queries over street samples. */
export class SpatialHash {
	private readonly cells: Map<number, StreamPoint[]> = new Map();

	constructor(private readonly cell: number) {}

	private key(cx: number, cz: number): number {
		return (cx + 32768) * 65536 + (cz + 32768);
	}

	add(p: StreamPoint): void {
		const k: number = this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
		const list: StreamPoint[] | undefined = this.cells.get(k);
		if (list) list.push(p);
		else this.cells.set(k, [p]);
	}

	/** The closest sample within `radius`, optionally skipping some. */
	nearest(x: number, z: number, radius: number, skip?: (p: StreamPoint) => boolean): StreamPoint | null {
		const span: number = Math.ceil(radius / this.cell);
		const cx: number = Math.floor(x / this.cell);
		const cz: number = Math.floor(z / this.cell);
		let best: StreamPoint | null = null;
		let bestD: number = radius * radius;
		for (let i: number = -span; i <= span; i++) {
			for (let j: number = -span; j <= span; j++) {
				const list: StreamPoint[] | undefined = this.cells.get(this.key(cx + i, cz + j));
				if (!list) continue;
				for (const p of list) {
					const d: number = (p.x - x) ** 2 + (p.z - z) ** 2;
					if (d < bestD && !(skip && skip(p))) {
						bestD = d;
						best = p;
					}
				}
			}
		}
		return best;
	}
}
