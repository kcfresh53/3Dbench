import type { RuleConfig, OffsetRuleConfig, OscillateRuleConfig, AttachRuleConfig } from '../core/rig_types';
import type { Vec3 } from '../core/math';
import { getRigData } from './ik_rig_project';
import { IKRigController } from './ik_rig_controller';

type EditableRule = OffsetRuleConfig | OscillateRuleConfig | AttachRuleConfig;

/** All distances are in model units; attachments use the selected object's local offset. */
export function editMotionRule(existing?: RuleConfig): void {
	const data = getRigData();
	if (!data || !data.config.goals.length) return;
	if (existing && !['offset', 'oscillate', 'attach'].includes(existing.kind)) return;
	const rule = existing as EditableRule | undefined;
	const project = Project;
	const selected = Outliner.selected[0]?.uuid;
	const attachments: Record<string, string> = { '': 'Choose a scene object' };
	for (const node of Object.values(OutlinerNode.uuids)) {
		if (node.mesh) attachments[node.uuid] = node.name;
	}
	new Dialog({
		id: 'ik_motion_rule', title: rule ? 'Edit Motion Rule' : 'Add Motion Rule',
		form: {
			kind: { label: 'Rule', type: 'select', value: rule?.kind ?? 'offset', options: { offset: 'Offset', oscillate: 'Oscillation', attach: 'Attach to object' } },
			goal: { label: 'Goal', type: 'select', value: rule?.goal ?? data.config.goals[0].id, options: Object.fromEntries(data.config.goals.map(goal => [goal.id, goal.label])) },
			space: { label: 'Offset space', type: 'select', value: rule?.kind == 'offset' ? rule.space : 'body', options: { body: 'Body facing', world: 'World', goal: 'Goal orientation' }, condition: form => form.kind == 'offset' },
			offset: { label: 'Offset XYZ', type: 'vector', dimensions: 3, value: rule && rule.kind != 'oscillate' ? [...rule.offset] : [0, 0, 0], condition: form => form.kind != 'oscillate' },
			amplitude: { label: 'Amplitude XYZ (world)', type: 'vector', dimensions: 3, value: rule?.kind == 'oscillate' ? [...rule.amplitude] : [0, 0, 0], condition: form => form.kind == 'oscillate' },
			frequency: { label: 'Frequency (Hz)', type: 'number', min: 0, max: 20, step: 0.05, value: rule?.kind == 'oscillate' ? rule.frequency : 1, condition: form => form.kind == 'oscillate' },
			phase: { label: 'Phase (cycles)', type: 'number', step: 0.05, value: rule?.kind == 'oscillate' ? rule.phase : 0, condition: form => form.kind == 'oscillate' },
			attachment: { label: 'Scene object', type: 'select', options: attachments, value: rule?.kind == 'attach' ? rule.attachment : selected ?? '', condition: form => form.kind == 'attach' },
			position: { label: 'Follow position', type: 'checkbox', value: rule?.kind == 'attach' ? rule.position : true, condition: form => form.kind == 'attach' },
			rotation: { label: 'Follow rotation', type: 'checkbox', value: rule?.kind == 'attach' ? rule.rotation : true, condition: form => form.kind == 'attach' },
		},
		onConfirm(values) {
			if (Project != project || getRigData() != data) return;
			if (values.kind == 'attach' && !OutlinerNode.uuids[values.attachment]) return;
			const common = { id: rule?.id ?? guid(), enabled: rule?.enabled ?? true, weight: rule?.weight ?? 1, goal: values.goal };
			let next: EditableRule;
			if (values.kind == 'offset') next = { ...common, kind: 'offset', space: values.space, offset: values.offset as Vec3 };
			else if (values.kind == 'oscillate') next = { ...common, kind: 'oscillate', amplitude: values.amplitude as Vec3, frequency: values.frequency, phase: values.phase };
			else next = { ...common, kind: 'attach', attachment: values.attachment, position: values.position, rotation: values.rotation, offset: values.offset as Vec3 };
			Undo.initEdit({ ik_rig: true });
			const index = rule ? data.config.rules.indexOf(rule) : -1;
			if (index >= 0) data.config.rules.splice(index, 1, next);
			else data.config.rules.push(next);
			Undo.finishEdit(rule ? 'Edit IK motion rule' : 'Add IK motion rule');
			IKRigController.forProject()?.configChanged();
		},
	}).show();
}
