import type { MeshData, Vec2, Vec3 } from './types';
/** Accumulates shared vertices and n-gon faces (3 or 4 sides). */
export declare class MeshBuilder {
    private positions;
    private faces;
    addVertex(position: Vec3): number;
    position(index: number): Vec3;
    addFace(indices: number[], uvs: Vec2[]): void;
    toData(): MeshData;
}
export declare function countTriangles(data: MeshData): number;
export declare function translateMesh(data: MeshData, offset: Vec3): MeshData;
export declare function mergeMeshData(a: MeshData, b: MeshData): MeshData;
/** Width of the XZ footprint, used to space LODs apart. */
export declare function footprintWidth(data: MeshData): number;
