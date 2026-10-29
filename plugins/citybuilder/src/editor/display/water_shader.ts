import type { WaterSettings } from '../../core/water/settings';

/**
 * Preview port of the Godot 4 water shader (MIT, by Somebody, https://t.me/somebody_dev). The effect
 * code follows the original line by line; the Godot built-ins that need the engine's screen and depth
 * buffers are replaced by what the city already has:
 *   hint_screen_texture -> the baked terrain albedo seen through the water
 *   hint_depth_texture  -> a depth map of the terrain below the water line, converted to the distance the
 *                          view ray travels under water
 * Lighting is a simple sun and sky model standing in for Godot's PBR pass. The mesh is never exported.
 */
export const WATER_VERTEX: string = /* glsl */ `
varying vec2 vUv;
varying vec2 vXZ;
varying vec3 vWorld;
void main() {
	vUv = uv;
	vXZ = position.xz;
	vec4 world = modelMatrix * vec4(position, 1.0);
	vWorld = world.xyz;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const WATER_FRAGMENT: string = /* glsl */ `
varying vec2 vUv;
varying vec2 vXZ;
varying vec3 vWorld;

uniform vec3 uWaterColor;
uniform float uColorRatio;
uniform float uAlphaScale;
uniform float uRoughness;
uniform float uNormal;
uniform sampler2D uNormalMap1;
uniform sampler2D uNormalMap2;
uniform sampler2D uSunHighlights;
uniform sampler2D uSunHighlights2;
uniform sampler2D uFoamTexture;
uniform sampler2D uBackdrop;
uniform sampler2D uDepth;
uniform float uHasBackdrop;
uniform float uTime;
uniform float uTimeScale;
uniform float uHighlightsTimeScale;
uniform float uUvScale;
uniform float uNormalBlend;
uniform float uHighlightsBlend;
uniform float uDepthDistance;
uniform float uFoamIntensity;
uniform float uFoamWidth;
uniform float uShoreFadeDistance;
uniform vec2 uAbberationR;
uniform vec2 uAbberationG;
uniform vec2 uAbberationB;
uniform vec2 uMapOrigin;
uniform vec2 uMapSize;
uniform vec3 uSunDir;

vec3 soft_light(vec3 base, vec3 blend) {
	vec3 limit = step(0.5, blend);
	return mix(2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
		sqrt(base) * (2.0 * blend - 1.0) + (2.0 * base) * (1.0 - blend), limit);
}

void main() {
	float TIME = uTime;
	vec2 _uv = vUv * uUvScale;
	// Where this fragment sits over the terrain: stands in for SCREEN_UV.
	vec2 _suv = (vXZ - uMapOrigin) / uMapSize;
	vec2 mapUv = _suv;

	vec2 uv_offset_1 = _uv;
	uv_offset_1.x += (TIME * uTimeScale * 0.01) + sin(TIME * uTimeScale + (uv_offset_1.x + uv_offset_1.y) * 25.0) * 0.01;
	uv_offset_1.y += (TIME * uTimeScale * 0.01) + cos(TIME * uTimeScale + (uv_offset_1.x + uv_offset_1.y) * 25.0) * 0.01;

	vec2 uv_offset_2 = _uv;
	uv_offset_2.x += (-TIME * uTimeScale * 0.01) + sin(-TIME * uTimeScale + (uv_offset_2.x + uv_offset_2.y) * 25.0) * 0.01;
	uv_offset_2.y += (-TIME * uTimeScale * 0.01) + cos(-TIME * uTimeScale + (uv_offset_2.x + uv_offset_2.y) * 25.0) * 0.01;

	vec2 highlights_offset_1 = _uv;
	highlights_offset_1.x += sin(TIME * uHighlightsTimeScale + (highlights_offset_1.x + highlights_offset_1.y) * 25.0) * 0.01;
	highlights_offset_1.y += cos(TIME * uHighlightsTimeScale + (highlights_offset_1.x + highlights_offset_1.y) * 25.0) * 0.01;

	vec2 highlights_offset_2 = _uv;
	highlights_offset_2.x += sin(-TIME * uHighlightsTimeScale + (highlights_offset_2.x + highlights_offset_2.y) * 25.0) * 0.01;
	highlights_offset_2.y += cos(-TIME * uHighlightsTimeScale + (highlights_offset_2.x + highlights_offset_2.y) * 25.0) * 0.01;

	_suv.x += sin(TIME * uTimeScale + (_suv.x + _suv.y)) * 0.002;
	_suv.y += cos(TIME * uTimeScale + (_suv.x + _suv.y)) * 0.002;

	float r1 = texture2D(uSunHighlights, highlights_offset_1 + uAbberationR).r;
	float g1 = texture2D(uSunHighlights, highlights_offset_1 + uAbberationG).g;
	float b1 = texture2D(uSunHighlights, highlights_offset_1 + uAbberationB).b;
	float r2 = texture2D(uSunHighlights2, highlights_offset_2 + uAbberationR).r;
	float g2 = texture2D(uSunHighlights2, highlights_offset_2 + uAbberationG).g;
	float b2 = texture2D(uSunHighlights2, highlights_offset_2 + uAbberationB).b;
	vec3 highlights = mix(vec3(r1, g1, b1), vec3(r2, g2, b2), uHighlightsBlend);

	vec3 ground = uHasBackdrop > 0.5 ? texture2D(uBackdrop, clamp(_suv, 0.0, 1.0)).rgb : vec3(0.35, 0.4, 0.33);
	vec3 blended = soft_light(ground, highlights);

	vec3 normal_1 = texture2D(uNormalMap1, uv_offset_1).rgb;
	vec3 normal_2 = texture2D(uNormalMap2, uv_offset_2).rgb;
	vec3 blended_normal = mix(normal_1, normal_2, uNormalBlend);

	// Depth: how far the view ray runs below the surface before it reaches the ground.
	vec3 V = normalize(cameraPosition - vWorld);
	float below = texture2D(uDepth, clamp(mapUv, 0.0, 1.0)).r;
	float depth_diff = below / max(abs(V.y), 0.12);

	// Shallow water shows the ground through a tint; deeper water absorbs light and turns to the deep
	// colour, so lakes read as water instead of dark holes. The original multiplies the colour by the
	// depth fade, which suits an engine with a lit ground behind it but blackens a viewport preview.
	float deep_t = clamp(depth_diff / max(uDepthDistance, 0.0001), 0.0, 1.0);
	float deep = deep_t * deep_t * (3.0 - 2.0 * deep_t);
	vec3 shallow_tint = mix(blended, uWaterColor, uColorRatio);
	vec3 deep_color = uWaterColor * vec3(0.32, 0.5, 0.62) + vec3(0.0, 0.015, 0.03);
	vec3 water_albedo = mix(shallow_tint, deep_color, deep);

	// Foam hugs the shoreline and breaks up with the foam texture instead of filling shallow flats.
	float foam_mask = 1.0 - smoothstep(0.0, max(uFoamWidth, 0.0001), depth_diff);
	foam_mask *= foam_mask;
	vec4 foam1 = texture2D(uFoamTexture, uv_offset_1 * 1.7);
	vec4 foam2 = texture2D(uFoamTexture, uv_offset_2 * 1.3 + 0.37);
	float foam_pattern = smoothstep(0.35, 0.8, mix(foam1.a, foam2.a, uNormalBlend));
	water_albedo = mix(water_albedo, vec3(0.92, 0.96, 0.98), clamp(foam_pattern * foam_mask * uFoamIntensity, 0.0, 0.85));

	float shore_alpha = smoothstep(0.0, max(uShoreFadeDistance, 0.0001), depth_diff);
	float alpha = mix(uAlphaScale, 0.96, deep * 0.7) * shore_alpha;
	if (alpha < 0.003) discard;

	// Sun and sky stand in for the engine's lighting.
	vec2 slope = (blended_normal.xy * 2.0 - 1.0) * uNormal * 1.5;
	vec3 N = normalize(vec3(slope.x, 1.0, slope.y));
	vec3 L = normalize(uSunDir);
	vec3 H = normalize(L + V);
	float smooth_amount = 1.0 - uRoughness;
	float spec = pow(max(dot(N, H), 0.0), mix(12.0, 420.0, smooth_amount)) * (0.3 + smooth_amount * 1.4);
	float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0) * (0.15 + smooth_amount * 0.5);
	vec3 lit = water_albedo * (0.62 + 0.38 * max(dot(N, L), 0.0));
	lit = mix(lit, vec3(0.62, 0.78, 0.95), fresnel) + vec3(spec);
	gl_FragColor = vec4(lit, alpha);
}
`;

export type WaterUniforms = Record<string, { value: unknown }>;

export interface WaterTextures {
	normal1: THREE.Texture;
	normal2: THREE.Texture;
	highlights1: THREE.Texture;
	highlights2: THREE.Texture;
	foam: THREE.Texture;
}

export function createWaterUniforms(textures: WaterTextures): WaterUniforms {
	return {
		uWaterColor: { value: new THREE.Vector3() },
		uColorRatio: { value: 0 },
		uAlphaScale: { value: 0 },
		uRoughness: { value: 0 },
		uNormal: { value: 0 },
		uNormalMap1: { value: textures.normal1 },
		uNormalMap2: { value: textures.normal2 },
		uSunHighlights: { value: textures.highlights1 },
		uSunHighlights2: { value: textures.highlights2 },
		uFoamTexture: { value: textures.foam },
		uBackdrop: { value: null },
		uDepth: { value: null },
		uHasBackdrop: { value: 0 },
		uTime: { value: 0 },
		uTimeScale: { value: 1 },
		uHighlightsTimeScale: { value: 0 },
		uUvScale: { value: 1 },
		uNormalBlend: { value: 0.5 },
		uHighlightsBlend: { value: 0.5 },
		uDepthDistance: { value: 1 },
		uFoamIntensity: { value: 0 },
		uFoamWidth: { value: 0.1 },
		uShoreFadeDistance: { value: 1 },
		uAbberationR: { value: new THREE.Vector2() },
		uAbberationG: { value: new THREE.Vector2() },
		uAbberationB: { value: new THREE.Vector2() },
		uMapOrigin: { value: new THREE.Vector2() },
		uMapSize: { value: new THREE.Vector2(1, 1) },
		uSunDir: { value: new THREE.Vector3(0, 1, 0) },
	};
}

/** Copies the settings into the shader's uniforms. */
export function applyWaterSettings(uniforms: WaterUniforms, s: WaterSettings): void {
	(uniforms.uWaterColor.value as THREE.Vector3).set(s.color[0], s.color[1], s.color[2]);
	uniforms.uColorRatio.value = s.colorRatio;
	uniforms.uAlphaScale.value = s.alphaScale;
	uniforms.uRoughness.value = s.roughness;
	uniforms.uNormal.value = s.normal;
	uniforms.uTimeScale.value = s.timeScale;
	uniforms.uHighlightsTimeScale.value = s.highlightsTimeScale;
	uniforms.uUvScale.value = s.uvScale;
	uniforms.uNormalBlend.value = s.normalBlend;
	uniforms.uHighlightsBlend.value = s.highlightsBlend;
	uniforms.uDepthDistance.value = s.depthDistance;
	uniforms.uFoamIntensity.value = s.foamIntensity;
	uniforms.uFoamWidth.value = s.foamWidth;
	uniforms.uShoreFadeDistance.value = s.shoreFadeDistance;
	(uniforms.uAbberationR.value as THREE.Vector2).set(s.aberrationR[0], s.aberrationR[1]);
	(uniforms.uAbberationG.value as THREE.Vector2).set(s.aberrationG[0], s.aberrationG[1]);
	(uniforms.uAbberationB.value as THREE.Vector2).set(s.aberrationB[0], s.aberrationB[1]);
}
