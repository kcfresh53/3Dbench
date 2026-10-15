/**
 * Grows covered pixels outward so that texture filtering and mip mapping never pick up
 * the empty background next to UV islands ("edge padding" / "bleed").
 * @param data RGBA pixels, modified in place
 * @param covered 1 for pixels that hold real content
 * @returns the coverage mask after dilation
 */
export function dilateRGBA(data: Uint8ClampedArray, covered: Uint8Array, width: number, height: number, iterations: number): Uint8Array {
	let current: Uint8Array = covered.slice();
	for (let iteration: number = 0; iteration < iterations; iteration++) {
		const next: Uint8Array = current.slice();
		let changed: boolean = false;
		for (let y: number = 0; y < height; y++) {
			for (let x: number = 0; x < width; x++) {
				const index: number = y * width + x;
				if (current[index]) continue;
				let r: number = 0, g: number = 0, b: number = 0, a: number = 0, n: number = 0;
				for (let dy: number = -1; dy <= 1; dy++) {
					const ny: number = y + dy;
					if (ny < 0 || ny >= height) continue;
					for (let dx: number = -1; dx <= 1; dx++) {
						const nx: number = x + dx;
						if (nx < 0 || nx >= width) continue;
						const ni: number = ny * width + nx;
						if (!current[ni]) continue;
						r += data[ni * 4]; g += data[ni * 4 + 1]; b += data[ni * 4 + 2]; a += data[ni * 4 + 3];
						n++;
					}
				}
				if (n) {
					data[index * 4] = r / n; data[index * 4 + 1] = g / n; data[index * 4 + 2] = b / n; data[index * 4 + 3] = a / n;
					next[index] = 1;
					changed = true;
				}
			}
		}
		current = next;
		if (!changed) break;
	}
	return current;
}
