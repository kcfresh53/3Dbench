import { child_process, electron, fs, os, PathModule, process } from '../../native_apis';
import { parseHexColor } from './color_scheme';

/**
 * Reads the accent color the host operating system exposes to applications:
 * macOS and Windows through Electron, GNOME (46+) and KDE Plasma through their settings.
 * Unavailable in the web build and on desktops that do not publish an accent color.
 */

export type SystemAccentSource = 'macos' | 'windows' | 'gnome' | 'kde';

export interface SystemAccentReading {
	color: string
	source: SystemAccentSource
}

/** GNOME's named accent colors (libadwaita palette). */
const GNOME_ACCENTS: Record<string, string> = {
	blue: '#3584e4',
	teal: '#2190a4',
	green: '#3a944a',
	yellow: '#c88800',
	orange: '#ed5b00',
	red: '#e62d42',
	pink: '#d56199',
	purple: '#9141ac',
	slate: '#6f8396',
};

function readElectronAccent(source: SystemAccentSource): SystemAccentReading | null {
	try {
		const color = parseHexColor(electron.systemPreferences.getAccentColor());
		return color ? { color, source } : null;
	} catch (error) {
		return null;
	}
}

function readGnomeAccent(): SystemAccentReading | null {
	try {
		const output = child_process.execFileSync('gsettings', ['get', 'org.gnome.desktop.interface', 'accent-color'], {
			timeout: 500,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		const color = GNOME_ACCENTS[output.trim().replace(/'/g, '')];
		return color ? { color, source: 'gnome' } : null;
	} catch (error) {
		return null;
	}
}

function readKdeAccent(): SystemAccentReading | null {
	try {
		const text = fs.readFileSync(PathModule.join(os.homedir(), '.config', 'kdeglobals'), 'utf8');
		const match = text.match(/^AccentColor=(\d+),(\d+),(\d+)/m);
		if (!match) return null;
		const color = '#' + match.slice(1, 4).map(value => Math.min(255, parseInt(value, 10)).toString(16).padStart(2, '0')).join('');
		return { color, source: 'kde' };
	} catch (error) {
		return null;
	}
}

export const SystemAccent = {
	/** The current system accent color, or null if this platform does not expose one. */
	read(): SystemAccentReading | null {
		if (!electron) return null;
		switch (process?.platform) {
			case 'darwin': return readElectronAccent('macos');
			case 'win32': return readElectronAccent('windows');
			case 'linux': return readGnomeAccent() ?? readKdeAccent();
			default: return null;
		}
	},
	isAvailable(): boolean {
		return this.read() !== null;
	},
	/** Calls the listener when the system accent color changes. Returns an unsubscribe function. */
	subscribe(listener: (reading: SystemAccentReading | null) => void): () => void {
		if (!electron) return () => {};
		let last: string | null = this.read()?.color ?? null;
		const check = (): void => {
			const reading = this.read();
			const color = reading?.color ?? null;
			if (color === last) return;
			last = color;
			listener(reading);
		};
		const cleanups: Array<() => void> = [];
		window.addEventListener('focus', check);
		cleanups.push(() => window.removeEventListener('focus', check));
		try {
			electron.nativeTheme.on('updated', check);
			cleanups.push(() => electron.nativeTheme.removeListener('updated', check));
			if (process?.platform === 'win32') {
				electron.systemPreferences.on('accent-color-changed', check);
				cleanups.push(() => electron.systemPreferences.removeListener('accent-color-changed', check));
			}
		} catch (error) {
			// Native change events are an optimization; focus polling remains.
		}
		return () => cleanups.forEach(cleanup => cleanup());
	},
};
