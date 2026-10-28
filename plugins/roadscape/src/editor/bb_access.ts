/** Small typed wrappers over untyped Blockbench toolbar items. */
interface SelectableItem {
	set(value: string): void;
	select(): void;
	value: string;
}

export function setSelectionMode(mode: 'vertex' | 'edge' | 'face' | 'object'): void {
	(BarItems.selection_mode as unknown as SelectableItem).set(mode);
}

export function selectionMode(): string {
	return (BarItems.selection_mode as unknown as SelectableItem).value;
}

export function selectMoveTool(): void {
	(BarItems.move_tool as unknown as SelectableItem).select();
}
