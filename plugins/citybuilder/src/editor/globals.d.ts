/** Node's module loader, which Blockbench's desktop app exposes to plugins. */
declare function require(id: string): unknown;

/** The preview scene system of 3D Bench: skyboxes and their cube maps live there, not in plugins. */
declare const PreviewScene: {
	active: { id: string; cubemap?: THREE.CubeTexture } | null;
	scenes: Record<string, { select(): Promise<void> }>;
};
