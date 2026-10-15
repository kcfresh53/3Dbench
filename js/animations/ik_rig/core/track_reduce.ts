/**
 * Keyframe reduction for baked animation tracks (Ramer-Douglas-Peucker on linear interpolation).
 * Keeps the first and last sample and every sample the reduced track could not reproduce within `tolerance`.
 */
export function reduceTrack(times: number[], values: number[][], tolerance: number): number[] {
	const count: number = times.length;
	if (count <= 2) return times.map((_: number, i: number): number => i);
	const keep: boolean[] = new Array(count).fill(false);
	keep[0] = true;
	keep[count - 1] = true;
	const stack: [number, number][] = [[0, count - 1]];
	while (stack.length) {
		const [start, end] = stack.pop() as [number, number];
		let worst: number = -1;
		let worst_error: number = tolerance;
		for (let i: number = start + 1; i < end; i++) {
			const t: number = (times[i] - times[start]) / (times[end] - times[start] || 1);
			let error: number = 0;
			for (let c: number = 0; c < values[i].length; c++) {
				const expected: number = values[start][c] + (values[end][c] - values[start][c]) * t;
				error = Math.max(error, Math.abs(values[i][c] - expected));
			}
			if (error > worst_error) { worst_error = error; worst = i; }
		}
		if (worst >= 0) {
			keep[worst] = true;
			stack.push([start, worst], [worst, end]);
		}
	}
	const kept: number[] = [];
	keep.forEach((flag: boolean, i: number): void => { if (flag) kept.push(i); });
	return kept;
}

/** Makes angle samples continuous: each value is shifted by multiples of `period` to sit closest to the previous one */
export function unwrapAngles(values: number[][], period: number = 360): number[][] {
	const result: number[][] = [];
	for (let i: number = 0; i < values.length; i++) {
		const current: number[] = values[i].slice();
		if (i > 0) {
			for (let c: number = 0; c < current.length; c++) {
				const previous: number = result[i - 1][c];
				current[c] -= Math.round((current[c] - previous) / period) * period;
			}
		}
		result.push(current);
	}
	return result;
}
