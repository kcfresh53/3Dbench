import type { RuleConfig } from '../core/rig_types';
import type { GoalRule } from './rule_context';
import { HandleRule } from './handle_rule';
import { GroundRule } from './ground_rule';
import { FootLockRule } from './foot_lock_rule';
import { AttachRule } from './attach_rule';
import { OffsetRule, OscillateRule } from './offset_rules';

export function createRule(config: RuleConfig): GoalRule {
	switch (config.kind) {
		case 'handle': return new HandleRule(config);
		case 'ground': return new GroundRule(config);
		case 'foot_lock': return new FootLockRule(config);
		case 'attach': return new AttachRule(config);
		case 'offset': return new OffsetRule(config);
		case 'oscillate': return new OscillateRule(config);
	}
}
