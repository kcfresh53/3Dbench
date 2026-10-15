import type { SolverConfig } from '../core/rig_types';
import type { IKSolver } from './ik_solver';
import { BodySolver } from './body_solver';
import { SpineSolver } from './spine_solver';
import { LimbSolver } from './limb_solver';
import { ChainSolver } from './chain_solver';
import { AimSolver } from './aim_solver';

export function createSolver(config: SolverConfig): IKSolver {
	switch (config.kind) {
		case 'body': return new BodySolver(config);
		case 'spine': return new SpineSolver(config);
		case 'limb': return new LimbSolver(config);
		case 'chain': return new ChainSolver(config);
		case 'aim': return new AimSolver(config);
	}
}
