import type { Vec2, Vec3 } from '../types';
import type { TileRef } from './tiles';

export type RoofKind = 'flat' | 'gable' | 'hip' | 'shed';
export type ShapeKind = 'rect' | 'L' | 'U' | 'T' | 'podium' | 'stepped';
export type FacadeStyle = 'house' | 'apartment' | 'shop' | 'curtain' | 'industrial' | 'civic';
export type RoofProp = 'hvac' | 'tank' | 'vent' | 'antenna' | 'chimney' | 'spire';
export type PieceTag = 'roof' | 'gable' | 'parapet' | 'awning' | 'prop' | 'trim';

/** Everything that decides what a building looks like. Equal specs share one prefab. */
export interface BuildingSpec {
	archetype: string;
	style: FacadeStyle;
	shape: ShapeKind;
	roof: RoofKind;
	/** Footprint size in bays. */
	nx: number;
	nz: number;
	/** Width of one bay (and of one grid cell), metres. */
	bay: number;
	floors: number;
	floorHeight: number;
	groundHeight: number;
	palette: number;
	/** Detail seed: window mix, prop placement. */
	seed: number;
	shopfront: boolean;
	awning: boolean;
	balconies: boolean;
	parapet: boolean;
	props: RoofProp[];
	/** Roof pitch in degrees for gable, hip and shed roofs. */
	pitch: number;
}

export interface FacadeRow {
	/** Height of the row's bottom above the ground, metres. */
	y0: number;
	height: number;
	/** One tile per bay, left to right as seen from outside. */
	tiles: TileRef[];
}

/** A straight wall: one or more bays wide and one or more rows tall. */
export interface FacadeRun {
	id: number;
	/** Bottom-left corner as seen from outside. */
	origin: Vec3;
	/** Unit direction from left to right as seen from outside. */
	along: Vec3;
	/** Unit outward normal. */
	normal: Vec3;
	bays: number;
	bayWidth: number;
	/** Rows from the bottom up. */
	rows: FacadeRow[];
	/** True for walls on the street side. */
	front: boolean;
}

/** A free polygon (3 or 4 corners) with its own tile: roofs, trim, awnings, props. */
export interface ModelPiece {
	corners: Vec3[];
	uvs: Vec2[];
	tile: TileRef;
	tag: PieceTag;
	/** Highest level of detail this piece still appears in (0 = only the finest). */
	maxLod: 0 | 1 | 2;
}

/** An axis-aligned block of the building, used for coarse LODs and collision. */
export interface Volume {
	x0: number;
	z0: number;
	x1: number;
	z1: number;
	height: number;
}

export interface BuildingModel {
	spec: BuildingSpec;
	/** Overall footprint, metres. */
	width: number;
	depth: number;
	/** Highest point, metres. */
	height: number;
	facades: FacadeRun[];
	pieces: ModelPiece[];
	volumes: Volume[];
}
