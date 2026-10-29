/** Toolbar icons: 24×24, drawn with strokes so they follow the theme's text colour. */
export type IconName =
	| 'select' | 'raise' | 'lower' | 'smooth' | 'flatten' | 'level' | 'biome'
	| 'district' | 'erase' | 'road' | 'roundabout' | 'roadtype'
	| 'brush' | 'rect' | 'polygon'
	| 'ground' | 'bridge' | 'tunnel' | 'air' | 'keep'
	| 'chevron_down' | 'chevron_up' | 'hand_right' | 'hand_left';

const PATHS: Record<IconName, string> = {
	select: 'M5 3l13 8-6 1.5L9.5 19z',
	raise: 'M3 19l6-9 4 5 3-4 5 8zM12 3v5M9.5 5.5L12 3l2.5 2.5',
	lower: 'M3 19l6-9 4 5 3-4 5 8zM12 8V3M9.5 5.5L12 8l2.5-2.5',
	smooth: 'M3 14c3-6 6-6 9 0s6 6 9 0',
	flatten: 'M3 7c3-2 6 0 9-1s6 0 9-1M3 17h18M12 9v6M9.5 12.5L12 15l2.5-2.5',
	level: 'M3 12h18M3 6h18M3 18h18M12 8v8',
	biome: 'M5 19c0-8 5-14 14-14 0 9-6 14-14 14zM5 19l8-8',
	district: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
	erase: 'M4 16l9-9 6 6-6 6H8zM9 12l6 6M12 20h8',
	road: 'M8 3L4 21M16 3l4 18M12 4v3M12 10.5v3M12 17v3',
	roundabout: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21',
	roadtype: 'M2 15h20M4 15v-3a8 8 0 0 1 16 0v3M8 15v-6M12 15V8M16 15v-6M3 19h18',
	brush: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
	rect: 'M4 6h16v12H4z',
	polygon: 'M5 18l2-11 9-3 4 9-6 6z',
	ground: 'M3 16h18M3 20h18M6 16c1-4 3-6 6-6s5 2 6 6',
	bridge: 'M2 17h20M4 17V9M20 17V9M4 9c4 7 12 7 16 0M8 14v3M12 15.5V17M16 14v3',
	tunnel: 'M3 20h18V10a9 9 0 0 0-18 0zM8 20v-6a4 4 0 0 1 8 0v6',
	air: 'M2 18h6M16 18h6M8 18c1-8 7-8 8 0M10 6l2-3 2 3',
	keep: 'M5 12h14M5 12l4-4M5 12l4 4',
	chevron_down: 'M6 9l6 6 6-6',
	chevron_up: 'M6 15l6-6 6 6',
	hand_right: 'M12 4a8 8 0 1 0 8 8M20 4v5h-5',
	hand_left: 'M12 4a8 8 0 1 1-8 8M4 4v5h5',
};

/** Builds an inline SVG for the icon. */
export function icon(name: IconName): SVGSVGElement {
	const ns: string = 'http://www.w3.org/2000/svg';
	const svg: SVGSVGElement = document.createElementNS(ns, 'svg') as SVGSVGElement;
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('width', '20');
	svg.setAttribute('height', '20');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.8');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	const path: SVGPathElement = document.createElementNS(ns, 'path') as SVGPathElement;
	path.setAttribute('d', PATHS[name]);
	svg.append(path);
	return svg;
}
