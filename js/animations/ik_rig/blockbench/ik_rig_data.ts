import type { IKRigConfig, JointKey } from '../core/rig_types';

export type GroundMode = 'flat' | 'objects';

export interface IKRigGroundSettings {
	mode: GroundMode;
	/** World height of the flat floor (the floor the animation was made for) */
	height: number;
	/** Elements used as terrain when mode is 'objects' */
	objects: string[];
}

/** Everything the project stores about its IK rig */
export interface IKRigProjectData {
	version: 1;
	enabled: boolean;
	config: IKRigConfig;
	/** Joint key -> bone uuid */
	bindings: Record<JointKey, string>;
	/** Skeleton roots: an armature or top level bones */
	roots: string[];
	/** Goal id -> uuid of the null object that acts as its handle */
	handles: Record<string, string>;
	/** Seconds a handle fades in before its first and out after its last keyframe */
	handle_blend: number;
	ground: IKRigGroundSettings;
}

export function createDefaultGround(): IKRigGroundSettings {
	return { mode: 'flat', height: 0, objects: [] };
}

/** True when project data describes a usable rig */
export function hasRig(data: Partial<IKRigProjectData> | null | undefined): data is IKRigProjectData {
	return !!data && data.version === 1 && !!data.config && Array.isArray(data.roots) && data.roots.length > 0;
}
