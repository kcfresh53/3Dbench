import { Blockbench } from '../../../api';
import { ModelProject } from '../../../io/project';
import { Property } from '../../../util/property';
import { hasRig, IKRigProjectData } from './ik_rig_data';

// The rig is stored with the project (.bbmodel) as plain JSON.
new Property(ModelProject, 'object', 'ik_rig', { exposed: false });

interface ProjectWithRig {
	ik_rig?: Partial<IKRigProjectData>;
}

/** Rig data of a project, or null when the project has no rig */
export function getRigData(project: ModelProject | null | undefined = Project): IKRigProjectData | null {
	const data: Partial<IKRigProjectData> | undefined = (project as unknown as ProjectWithRig | null)?.ik_rig;
	return hasRig(data) ? data : null;
}

export function setRigData(project: ModelProject, data: IKRigProjectData | null): void {
	(project as unknown as ProjectWithRig).ik_rig = data ?? {};
}

// Explicit undo aspect keeps interactive rig edits and rule-stack changes reversible.
declare global {
	interface UndoAspects { ik_rig?: boolean }
}
type RigUndoSave = UndoSave & { ik_rig?: IKRigProjectData | null };
Blockbench.on('create_undo_save', ({ save, aspects }): void => {
	if (aspects.ik_rig) (save as RigUndoSave).ik_rig = JSON.parse(JSON.stringify(getRigData()));
});
Blockbench.on('load_undo_save', ({ save }): void => {
	if (Object.prototype.hasOwnProperty.call(save, 'ik_rig')) {
		setRigData(Project, JSON.parse(JSON.stringify((save as RigUndoSave).ik_rig)));
	}
});
