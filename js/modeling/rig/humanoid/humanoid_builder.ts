import { BoneSpec, BuildContext, ComponentOutput, HumanoidComponent, HumanoidParams, MeshSpec } from './humanoid_types';
import { assembleBody } from './surface';
import { computeLandmarks } from './landmarks';
import { mergeMeshes } from './loft';
import { TorsoComponent } from './components/torso_component';
import { NeckHeadComponent } from './components/neck_head_component';
import { ArmComponent } from './components/arm_component';
import { LegComponent } from './components/leg_component';

/** The components that make up a humanoid. Add or replace entries to customize the character. */
export function defaultHumanoidComponents(): HumanoidComponent[] {
	return [
		new TorsoComponent(),
		new NeckHeadComponent(),
		new LegComponent('L'),
		new LegComponent('R'),
		new ArmComponent('L'),
		new ArmComponent('R'),
	];
}

/**
 * Builds the skeleton and body meshes of a humanoid from its parameters.
 * Bones are ordered so that parents always come before their children.
 */
export function buildHumanoid(params: HumanoidParams, components?: HumanoidComponent[]): ComponentOutput {
	const context: BuildContext = { params, landmarks: computeLandmarks(params) };
	const bones: BoneSpec[] = [];
	let meshes: MeshSpec[] = [];
	for (const component of components ?? defaultHumanoidComponents()) {
		const output: ComponentOutput = component.build(context);
		bones.push(...output.bones);
		meshes.push(...output.meshes);
	}
	if (params.generate_mesh && params.style !== 'blocky' && !components) {
		meshes = assembleBody(meshes, context.landmarks.sides);
	}
	if (params.single_mesh && meshes.length > 1) {
		meshes = [mergeMeshes('body', meshes)];
	}
	return { bones, meshes };
}
