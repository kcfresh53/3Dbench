import type { TreeParams } from '../core/types';
export interface FieldSpec {
    key: keyof TreeParams;
    label: string;
    type: 'number' | 'select' | 'checkbox' | 'color' | 'file';
    min?: number;
    max?: number;
    step?: number;
    integer?: boolean;
    options?: Record<string, string>;
    /** Select values that should be converted back to numbers. */
    numeric?: boolean;
    description?: string;
}
export type FormEntry = FieldSpec | {
    separator: string;
};
export declare const FORM_ENTRIES: FormEntry[];
export declare function isFieldSpec(entry: FormEntry): entry is FieldSpec;
