export interface Disposable {
	delete(): void;
}

interface Emitter {
	on(event: string, callback: (data: never) => void): Disposable;
}

/** Subscribes to a Blockbench event source and returns the subscription handle. */
export function listen<T>(target: unknown, events: string, callback: (data: T) => void): Disposable {
	return (target as Emitter).on(events, callback as (data: never) => void);
}
