/** Blockbench pieces the road editor touches that the shipped typings leave out. */
export {};

declare global {
	interface Window {
		__roadscapeLoaded?: boolean;
	}
}
