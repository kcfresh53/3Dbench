import type { PresetName, TreeParams } from '../core/types';
export interface TreeDialogRequest {
    preset: PresetName;
    params: TreeParams;
    /** True when regenerating an existing tree group. */
    editing: boolean;
}
export declare function defaultRequest(): TreeDialogRequest;
/** Opens the generator with a live preview. `onConfirm` receives the final parameters. */
export declare function openTreeDialog(request: TreeDialogRequest, onConfirm: (params: TreeParams, preset: PresetName) => void): void;
