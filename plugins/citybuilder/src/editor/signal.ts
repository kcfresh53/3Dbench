/** Smallest possible event: listeners are called in subscription order. */
export class Signal<T> {
	private readonly listeners: Array<(value: T) => void> = [];

	on(listener: (value: T) => void): () => void {
		this.listeners.push(listener);
		return (): void => {
			const i: number = this.listeners.indexOf(listener);
			if (i >= 0) this.listeners.splice(i, 1);
		};
	}

	emit(value: T): void {
		for (const l of [...this.listeners]) {
			try {
				l(value);
			} catch (error) {
				console.error('CityBuilder listener', error);
			}
		}
	}
}
