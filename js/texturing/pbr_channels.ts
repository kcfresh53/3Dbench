/**
 * Generic PBR channel definitions.
 * Every channel lives in its own texture (grayscale for scalar channels), so no format-specific channel packing is required.
 */

export type PBRChannel = 'color' | 'normal' | 'height' | 'roughness' | 'metalness' | 'emissive' | 'ao';

export interface PBRChannelInfo {
	id: PBRChannel
	/** Material icon name */
	icon: string
	/** Lang key for the display name */
	lang_key: string
	/** Scalar channels are stored as grayscale images and have a uniform fallback value */
	scalar: boolean
	/** File name suffix used when generating textures for this channel */
	suffix: string
	/** Pattern used to guess a channel from a texture file name */
	name_pattern: RegExp
	/** Uniform fallback value, 0-255. Only for scalar channels */
	default_value: number
}

export const PBR_CHANNELS: Record<PBRChannel, PBRChannelInfo> = {
	color: {id: 'color', icon: 'palette', lang_key: 'menu.texture.pbr_channel.color', scalar: false, suffix: 'color', name_pattern: /[._-](albedo|diffuse|basecolor|base_color|color)\b/i, default_value: 255},
	normal: {id: 'normal', icon: 'area_chart', lang_key: 'menu.texture.pbr_channel.normal', scalar: false, suffix: 'normal', name_pattern: /[._-](normal|nrm|nor)\b/i, default_value: 0},
	height: {id: 'height', icon: 'landscape', lang_key: 'menu.texture.pbr_channel.height', scalar: false, suffix: 'height', name_pattern: /[._-](height|bump|displacement|disp)\b/i, default_value: 0},
	roughness: {id: 'roughness', icon: 'grain', lang_key: 'menu.texture.pbr_channel.roughness', scalar: true, suffix: 'roughness', name_pattern: /[._-](roughness|rough|rgh)\b/i, default_value: 204},
	metalness: {id: 'metalness', icon: 'hardware', lang_key: 'menu.texture.pbr_channel.metalness', scalar: true, suffix: 'metalness', name_pattern: /[._-](metalness|metallic|metal|mtl)\b/i, default_value: 0},
	emissive: {id: 'emissive', icon: 'brightness_5', lang_key: 'menu.texture.pbr_channel.emissive', scalar: true, suffix: 'emissive', name_pattern: /[._-](emissive|emission|emit|glow)\b/i, default_value: 0},
	ao: {id: 'ao', icon: 'filter_drama', lang_key: 'menu.texture.pbr_channel.ao', scalar: true, suffix: 'ao', name_pattern: /[._-](ao|occlusion|ambientocclusion|ambient_occlusion)\b/i, default_value: 255},
};

export const PBR_CHANNEL_IDS: PBRChannel[] = Object.keys(PBR_CHANNELS) as PBRChannel[];
export const SCALAR_CHANNEL_IDS: PBRChannel[] = PBR_CHANNEL_IDS.filter((id: PBRChannel): boolean => PBR_CHANNELS[id].scalar);

/** Maps stored channel strings, including legacy ones from older files, to a valid channel. */
export function migrateChannel(raw: string | undefined): PBRChannel {
	if (!raw) return 'color';
	if (raw in PBR_CHANNELS) return raw as PBRChannel;
	// Legacy packed metal-emissive-roughness maps cannot be represented anymore, treat them as roughness
	if (raw === 'mer' || raw === 'mer_subsurface') return 'roughness';
	return 'color';
}

export function guessChannelFromName(name: string): PBRChannel | null {
	for (const id of PBR_CHANNEL_IDS) {
		if (id === 'color') continue;
		if (PBR_CHANNELS[id].name_pattern.test(name)) return id;
	}
	return null;
}

/** Channels that influence the live material preview when edited */
export function isMaterialChannel(channel: string): boolean {
	return channel !== 'color';
}

(window as any).PBRChannels = {PBR_CHANNELS, PBR_CHANNEL_IDS, SCALAR_CHANNEL_IDS, migrateChannel, guessChannelFromName, isMaterialChannel};
