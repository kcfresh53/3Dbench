export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type FoliageStyle = 'cards' | 'blobs' | 'tiers' | 'fronds' | 'none';
export type CrownShape = 'round' | 'conical' | 'columnar' | 'vase';
export type LeafKind = 'broadleaf' | 'needle' | 'palm';
export type Species = 'oak' | 'pine' | 'birch' | 'bush' | 'dead' | 'palm';
export type Variant = 'stylized' | 'realistic';
export type PresetName = `${Species}_${Variant}`;
/** Everything the generator needs. Keys double as dialog field keys. */
export interface TreeParams {
    variant: Variant;
    seed: number;
    /** Total height in model units. */
    height: number;
    /** Trunk base radius as a percentage of height. */
    trunkThickness: number;
    trunkSides: number;
    trunkSegments: number;
    /** Fraction of base radius left just below the tip (0..1). */
    trunkTaper: number;
    rootFlare: number;
    trunkBend: number;
    /** Number of branch generations on top of the trunk (0..3). */
    branchLevels: number;
    branchCount: number;
    /** Fraction of the trunk that stays bare before the first branch. */
    branchStart: number;
    /** Angle between branch and parent, degrees. */
    branchAngle: number;
    /** Child length as a ratio of parent length. */
    branchLength: number;
    /** Child radius as a ratio of parent radius. */
    branchThickness: number;
    branchBend: number;
    /** -1 droops, +1 reaches upward. */
    gravity: number;
    crownShape: CrownShape;
    foliageStyle: FoliageStyle;
    /** Foliage cluster size (or tier radius) as a percentage of height. */
    foliageSize: number;
    /** Clusters per terminal branch, or number of tiers for 'tiers'. */
    foliageDensity: number;
    /** Fraction along a terminal branch where foliage starts. */
    foliageStart: number;
    cardPlanes: number;
    /** 0 = octahedron blobs (8 tris), 1 = icosahedron blobs (20 tris). */
    blobDetail: number;
    leafKind: LeafKind;
    barkColor: string;
    leafColor: string;
    leafColor2: string;
    textureSize: number;
    separateFoliage: boolean;
    lodCount: number;
    /** Side-by-side editor layout; false keeps export LODs at a shared origin. */
    spreadLods: boolean;
    maxTriangles: number;
    /** When true and an image is present, it replaces the procedural paint for that slot. */
    useCustomTextures: boolean;
    /** Use bundled CC0 photographs in realistic presets. */
    useBundledTextures: boolean;
    /** Data URL of a user supplied bark image, or ''. */
    barkImage: string;
    /** Data URL of a user supplied leaf image (PNG with alpha recommended), or ''. */
    leafImage: string;
}
export interface Branch {
    points: Vec3[];
    /** One radius per point. A radius of 0 on the last point collapses the tube to a tip. */
    radii: number[];
    level: number;
    length: number;
    /** Stable skeleton hierarchy used to remove detail without moving retained branches. */
    parentIndex?: number;
    priority?: number;
}
export interface MeshFaceData {
    /** 3 or 4 vertex indices, counter-clockwise seen from the front. */
    indices: number[];
    /** Normalised 0..1 atlas coordinates (origin top-left), one per index. */
    uvs: Vec2[];
}
export interface MeshData {
    positions: Vec3[];
    faces: MeshFaceData[];
}
export interface TreeLod {
    trunk: MeshData;
    foliage: MeshData;
    triangles: number;
    /** Quality scalar the budget solver settled on (1 = full detail). */
    quality: number;
    withinBudget: boolean;
}
