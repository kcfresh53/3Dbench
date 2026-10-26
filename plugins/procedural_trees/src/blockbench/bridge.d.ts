import type { PresetName, TreeLod, TreeParams } from '../core/types';
/** Group property that marks a generated tree and stores the settings to edit it again. */
export declare const TREE_KEY = "procedural_tree";
export declare function readStoredTree(group: Group): {
    preset: PresetName;
    params: TreeParams;
} | null;
export declare function selectedTreeGroup(): Group | null;
/**
 * Creates (or regenerates) a tree as one undo step: one atlas texture, a group per LOD,
 * and trunk/foliage meshes inside. Regenerating replaces the group's contents.
 */
export declare function createTreeInProject(lods: TreeLod[], atlasUrl: string, params: TreeParams, preset: PresetName, existing: Group | null): void;
