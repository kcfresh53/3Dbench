import { isStringNumber } from "../util/math_util"
import { EffectAnimator } from "./timeline_animators"

Animator.MolangParser.context = {}
Animator.MolangParser.global_variables = {
	true: 1,
	false: 0,
	get 'query.delta_time'() {
		let time = (performance.now() - Timeline.last_frame_timecode) / 1000
		if (time < 0) time += 1
		return Math.clamp(time, 0, 0.1)
	},
	get 'query.anim_time'() {
		return Animator.MolangParser.context.animation
			? Animator.MolangParser.context.animation.time
			: Timeline.time
	},
	get 'query.life_time'() {
		return Timeline.time
	},
	get 'query.time_stamp'() {
		return Math.floor(Timeline.time * 20);
	},
	'query.camera_rotation'(axis) {
		let val = cameraTargetToRotation(
			Preview.selected.camera.position.toArray(),
			Preview.selected.controls.target.toArray()
		)[axis ? 0 : 1]
		if (axis == 0) val *= -1
		return val
	},
	'query.rotation_to_camera'(axis) {
		let val = cameraTargetToRotation([0, 0, 0], Preview.selected.camera.position.toArray())[
			axis ? 0 : 1
		]
		if (axis == 0) val *= -1
		return val
	},
	get 'query.distance_from_camera'() {
		return Preview.selected.camera.position.length() / Format.block_size
	},
	'query.lod_index'(indices) {
		indices.sort((a, b) => a - b)
		let distance = Preview.selected.camera.position.length() / Format.block_size
		let index = indices.length
		indices.forEachReverse((val, i) => {
			if (distance < val) index = i
		})
		return index
	},
	'query.camera_distance_range_lerp'(a, b) {
		let distance = Preview.selected.camera.position.length() / Format.block_size
		return Math.clamp(Math.getLerp(a, b, distance), 0, 1)
	},
	'query.get_default_bone_pivot'(bone_name, axis) {
		let group = Group.all.find(g => g.name.toLowerCase() == bone_name);
		if (group && axis >= 0 && axis < 3) {
			let value = group.origin[axis] ?? 0;
			if (axis == 0) value *= -1;
			return value;
		}
	},
	get time() {
		return Timeline.time
	},
}
const variable_fallbacks = {
	'query.model_scale': 1/16,
};
Animator.MolangParser.variableHandler = function (variable, variables, args) {
	let variable_with_args = args?.length && `${variable}(${args.map(arg => isStringNumber(arg) ? arg : "'"+arg+"'").join(',')})`;

	const val = Animator.global_variable_lines[variable] ?? Animator.global_variable_lines[variable_with_args];
	if (val === undefined) {
		if (variable_fallbacks[variable] != undefined) return variable_fallbacks[variable];
		return;
	}

	if (val.match(/^(slider|toggle|impulse)\(/)) {
		let [type, content] = val.substring(0, val.lastIndexOf(')')).split(/\(/)
		let [id] = content.split(/\(|, */)
		id = id.replace(/['"]/g, '')

		let button = Panels.variable_placeholders.inside_vue.buttons.find(
			(b) => b.id === id && b.type == type
		)
		return button ? parseFloat(button.value) : 0
	} else {
		return val[0] == `'` ? val : Animator.MolangParser.parse(val, variables)
	}
}

export function getAllMolangExpressions() {
	let expressions = []
	Animation.all.forEach((animation) => {
		for (let key in Animation.properties) {
			let property = Animation.properties[key]
			if (
				Condition(property.condition, animation) &&
				property.type == 'molang' &&
				animation[key] &&
				isNaN(animation[key])
			) {
				let value = animation[key]
				expressions.push({
					value,
					type: 'animation',
					key,
					animation,
				})
			}
		}

		for (let key in animation.animators) {
			let animator = animation.animators[key]
			for (let channel in animator.channels) {
				animator[channel].forEach((kf, i) => {
					kf.data_points.forEach((data_point) => {
						for (let key in KeyframeDataPoint.properties) {
							let property = KeyframeDataPoint.properties[key]
							if (
								Condition(property.condition, data_point) &&
								property.type == 'molang' &&
								data_point[key] &&
								isNaN(data_point[key])
							) {
								expressions.push({
									value: data_point[key],
									type: 'keyframe',
									key,
									animation,
									animator,
									channel,
									kf,
								})
							}
						}
					})
				})
			}
		}
	})
	return expressions
}

new ValidatorCheck('molang_syntax', {
	condition: { features: ['animation_mode', 'molang'] },
	update_triggers: ['update_keyframe_selection', 'edit_animation_properties'],
	run() {
		let check = this
		let keywords = ['return', 'continue', 'break']
		let two_expression_regex =
			isApp || window.chrome ? new RegExp('(?<!\\w)[0-9._]+\\(|\\)[a-z0-9._]+') : null
		function validateMolang(string, message, instance) {
			if (!string || typeof string !== 'string') return
			let clear_string = string.replace(/'.*'/g, '0')

			let issues = []
			if (clear_string.match(/([-+*/]\s*[+*/])|(\+\s*-)/)) {
				issues.push('Two directly adjacent operators')
			}
			if (clear_string.match(/^[+*/.,?=&<>|]/)) {
				issues.push('Expression starts with an invalid character')
			}
			if (
				clear_string.endsWith(';') &&
				!clear_string.includes('return ') &&
				!(instance instanceof Keyframe && instance.animator instanceof EffectAnimator)
			) {
				issues.push('Complex expression with no return value. Remove the semicolon or add a return statement')
			}
			if (
				(clear_string.match(/[\w.]\s+[\w.]/) &&
					!keywords.find((k) => clear_string.includes(k))) ||
				clear_string.match(/\)\(/) ||
				(two_expression_regex && clear_string.match(two_expression_regex))
			) {
				issues.push('Two expressions with no operator in between')
			}
			if (clear_string.match(/(^|[^a-z0-9_])[\d.]+[a-z_]+/i)) {
				issues.push(
					'Invalid token ' +
						clear_string
							.match(/(^|[^a-z0-9_])[\d.]+[a-z_]+/i)[0]
							.replace(/[^a-z0-9._]/g, '')
				)
			}
			if (clear_string.match(/[^\w\s+\-*/(){}.,;:[\]!?=<>&|]/)) {
				issues.push(
					'Invalid character: ' +
						clear_string.match(/[^\s\w+\-*/(){}.,;:[\]!?=<>&|]+/g).join(', ')
				)
			}
			let left = string.match(/\(/g) || 0
			let right = string.match(/\)/g) || 0
			if (left.length !== right.length) {
				issues.push('Brackets do not match')
			}

			if (issues.length) {
				let button
				if (instance instanceof Animation) {
					button = {
						name: 'Edit Animation',
						icon: 'movie',
						click() {
							Dialog.open.close()
							instance.propertiesDialog()
						},
					}
				} else {
					button = {
						name: 'Reveal Keyframe',
						icon: 'icon-keyframe',
						click() {
							Dialog.open.close()
							instance.showInTimeline()
						},
					}
				}
				check.fail({
					message: `${message} ${issues.join('; ')}. Script: \`${string}\``,
					buttons: [button],
				})
			}
		}

		getAllMolangExpressions().forEach((ex) => {
			if (ex.type == 'animation') {
				validateMolang(
					ex.value,
					`Property "${ex.key}" on animation "${ex.animation.name}" contains invalid molang:`,
					ex.animation
				)
			} else if (ex.type == 'keyframe') {
				let channel_name = ex.animator.channels[ex.channel].name
				validateMolang(
					ex.value,
					`${channel_name} keyframe at ${ex.kf.time.toFixed(2)} on "${
						ex.animator.name
					}" in "${ex.animation.name}" contains invalid molang:`,
					ex.kf
				)
			}
		})
	},
})

/**
 * Global Molang autocomplete object
 */
export const MolangAutocomplete = {}

/**
 * Gets all the Molang variables used in the project
 * @param {string[]} excluded Variable names to exclude
 * @returns {Set<string>}
 */
export function getProjectMolangVariables(excluded) {
	const variables = new Set()
	const expressions = getAllMolangExpressions()
	for (const expression of expressions) {
		if (!expression.value) continue
		const matches = expression.value.match(/(v|variable)\.(\w+)/gi)
		if (!matches) continue
		for (const match of matches) {
			const name = match.split('.')[1]
			if (!(excluded && excluded.includes(name))) variables.add(name)
		}
	}
	return variables
}

/**
 * Gets the temporary Molang variables in a molang expression string
 * @param {string} expression
 * @param {string[]} excluded Variable names to exclude
 * @returns {Set<string>}
 */
export function getTemporaryMolangVariables(expression, excluded) {
	const variables = new Set()
	const matches = expression.match(/(t|temp)\.(\w+)/gi)
	if (!matches) return variables
	for (const match of matches) {
		const name = match.split('.')[1]
		if (!(excluded && excluded.includes(name))) variables.add(name)
	}
	return variables
}

/**
 * Sorts autocomplete results based on how well they match the incomplete string, then alphabetically
 * @param {MolangAutocompleteResult[]} results
 * @param {string} incomplete
 * @returns {MolangAutocompleteResult[]}
 */
export function sortAutocompleteResults(results, incomplete) {
	return results.sort((a, b) => {
		if (a.priority && b.priority) return b.priority - a.priority
		else if (a.priority) return -1
		else if (b.priority) return 1
		if (a.text.startsWith(incomplete) && !b.text.startsWith(incomplete)) return -1
		if (b.text.startsWith(incomplete) && !a.text.startsWith(incomplete)) return 1
		return a.text.localeCompare(b.text)
	})
}

;(function () {
	/**
	 * @typedef MolangAutocompleteResult
	 * @property {string} text The text to insert
	 * @property {string} [label] The label to display in the autocomplete menu
	 * @property {number} overlap The number of characters to overlap with the incomplete string
	 * @property {number} [priority] The suggestion priority. A higher number means it will be suggested first
	 */

	/**
	 * @typedef RootToken
	 * @property {string} id The ID of the new root token
	 * @property {string[]} [arguments] The arguments of the root token
	 * @property {number} [priority] The suggestion priority of the root token. A higher number means it will be suggested first
	 */

	/**
	 * @typedef Query
	 * @property {string} id The ID of the new query
	 * @property {string[]} [arguments] The arguments of the query
	 * @property {number} [priority] The suggestion priority of the query. A higher number means it will be suggested first
	 */

	/**
	 * @typedef NamespaceOptions
	 * @property {string} id The ID of the new namespace
	 * @property {string} [shorthand] The shorthand of the new namespace. Eg. `q` for `query`
	 * @property {number} [priority] The suggestion priority of the namespace. A higher number means it will be suggested first
	 */

	MolangAutocomplete.Namespace = class Namespace {
		/**
		 * @type {string} The ID of the namespace.
		 */
		id
		/**
		 * @type {string}
		 */
		shorthand
		/**
		 * @type {Map<string, Query>}
		 */
		queries = new Map()
		/**
		 * @type {Map<string, () => Query[]>}
		 */
		queryGetters = new Map()
		/**
		 * @param {NamespaceOptions} options
		 */
		constructor(options) {
			this.id = options.id
			this.shorthand = options.shorthand
		}

		/**
		 * Adds a new query to the namespace
		 * @param {Query} query
		 * @returns {Namespace} This namespace
		 */
		addQuery(query) {
			this.queries.set(query.id, query)
			return this
		}

		/**
		 * @param {string} queryID
		 * @returns {boolean} True if the query exists in the namespace
		 */
		hasQuery(queryID) {
			// This function isn't used internally, but keeps the API consistent for plugin devs.
			return this.queries.has(queryID)
		}

		/**
		 * Removes a query from the namespace
		 * @param {string} queryID
		 * @returns {boolean} True if the query was removed, false if it did not exist
		 */
		removeQuery(queryID) {
			return this.queries.delete(queryID)
		}

		/**
		 * Adds a getter function that returns dynamically generated queries.
		 * @param {string} id
		 * @param {(incomplete: string) => Query[]} getter
		 * @returns {Namespace} This namespace
		 */
		addQueryGetter(id, getter) {
			this.queryGetters.set(id, getter)
			return this
		}

		/**
		 * Removes a query getter function
		 * @param {string} id
		 */
		removeQueryGetter(id) {
			this.queryGetters.delete(id)
		}

		/**
		 * @typedef NamespaceUnionOptions
		 * @property {string} id The ID of the new namespace
		 * @property {string} [shorthand] The shorthand of the new namespace. Eg. `q` for `query`
		 * @property {number} [priority] The suggestion priority of the namespace. A higher number means it will be suggested first
		 */

		/**
		 * Creates a new Namespace that is a union of this namespace and another
		 * @param {Namespace} other
		 * @param {NamespaceUnionOptions} [options] Options to override the new namespace's properties. If not provided, the new namespace will inherit this namespace's properties
		 * @returns {Namespace} The new namespace
		 */
		createUnion(other, options) {
			const union = new MolangAutocomplete.Namespace({
				id: options?.id || this.id,
				shorthand: options?.shorthand || this.shorthand,
				priority: options?.priority || this.priority,
			})
			union.queries = new Map([...this.queries, ...other.queries])
			union.queryGetters = new Map([...this.queryGetters, ...other.queryGetters])
			return union
		}

		/**
		 * Returns any queries in this namespace who's ID starts with `incomplete`.
		 * @param {string} expression The expression the query is being used in
		 * @param {string} incomplete The incomplete query ID
		 * @param {boolean} [recursive=true] If true, will also search inherited contexts
		 * @returns {Query[]} The queries
		 */
		getPossibleQueries(expression, incomplete, recursive = true) {
			const possibleQueries = []
			this.queries.forEach((query) => {
				if (query.id.startsWith(incomplete)) possibleQueries.push(query)
			})
			this.queryGetters.values().forEach((getter) => {
				const queries = getter(expression, incomplete)
				queries.forEach((query) => {
					if (query.id.startsWith(incomplete)) possibleQueries.push(query)
				})
			})
			if (recursive && this.inheritedContext) {
				return [
					...possibleQueries,
					...this.inheritedContext.getPossibleQueries(expression, incomplete),
				]
			}
			return possibleQueries
		}
	}

	/**
	 * @typedef MolangAutocompleteContextOptions
	 * @property {string} id
	 * @property {string[]} [rootTokens]
	 * @property {MolangAutocomplete.Context} [inheritedContext]
	 */

	MolangAutocomplete.Context = class Context {
		/**
		 * @type {MolangAutocomplete.Context[]}
		 */
		static all = []
		/**
		 * @type {string}
		 */
		id
		/**
		 * @type {Map<string, RootToken>}
		 */
		rootTokens = new Map()
		/**
		 * @type {Map<string, Namespace>}
		 */
		namespaces = new Map()
		/**
		 * @type {MolangAutocomplete.Context}
		 */
		inheritedContext

		/**
		 * @param {MolangAutocompleteContextOptions} options
		 */
		constructor(options) {
			this.id = options.id
			this.inheritedContext = options.inheritedContext
			MolangAutocomplete.Context.all.push(this)
		}

		/**
		 * Adds a new root token to the context
		 * @param {RootToken} token
		 * @returns {Context} This context
		 */
		addRootToken(token) {
			this.rootTokens.set(token.id, token)
			return this
		}

		/**
		 * Returns the root token with the given ID
		 * @param {string} tokenID
		 * @returns {RootToken} The root token, or undefined if it does not exist
		 */
		getRootToken(tokenID) {
			return this.rootTokens.get(tokenID)
		}

		/**
		 * Removes a root token from the context
		 * @param {string} tokenID
		 * @returns {boolean} True if the token was removed, false if it did not exist
		 * @returns {boolean}
		 */
		removeRootToken(tokenID) {
			return this.rootTokens.delete(tokenID)
		}

		/**
		 * Returns true if the context has a namespace with the given ID
		 * @param {string} namespaceID
		 * @param {boolean} [recursive=true] If true, will also search inherited contexts
		 * @returns {boolean}
		 */
		hasNamespace(namespaceID, recursive = true) {
			if (this.namespaces.has(namespaceID)) return true
			if (recursive && this.inheritedContext)
				return this.inheritedContext.hasNamespace(namespaceID)
			return false
		}

		/**
		 * Adds a new namespace to the context
		 * @param {Namespace} namespace
		 * @param {boolean} [createUnion=true] If true, will create a union of the namespace with any existing namespaces with the same ID. If false, will overwrite any existing namespaces with the same ID. (Default: true)
		 * @returns {Context} This context
		 */
		addNamespace(namespace, createUnion = true) {
			if (createUnion && this.namespaces.has(namespace.id)) {
				this.namespaces.set(
					namespace.id,
					this.namespaces.get(namespace.id).createUnion(namespace)
				)
			} else {
				this.namespaces.set(namespace.id, namespace)
			}
			return this
		}

		/**
		 * Returns the namespace with the given ID
		 *
		 * @param {string} namespaceID
		 * @param {boolean} [recursive=true] If true, will also search inherited contexts
		 * @returns {Namespace} The namespace, or undefined if it does not exist
		 */
		getNamespace(namespaceID, recursive = true) {
			if (recursive && this.inheritedContext) {
				const subNamespace = this.inheritedContext.getNamespace(namespaceID)
				if (this.namespaces.has(namespaceID)) {
					const namespace = this.namespaces.get(namespaceID)
					if (subNamespace) {
						return namespace.createUnion(subNamespace)
					}
				}
				return subNamespace
			}
			if (this.namespaces.has(namespaceID)) return this.namespaces.get(namespaceID)
			return undefined
		}

		/**
		 * Removes a namespace from the context
		 *
		 * This will not remove namespaces from inherited contexts
		 * @param {string} namespaceID
		 * @returns {boolean} True if the namespace was removed, false if it did not exist
		 */
		removeNamespace(namespaceID) {
			return this.namespaces.delete(namespaceID)
		}

		/**
		 * Returns any namespaces in this context who's ID starts with `incomplete`.
		 * @param {string} incomplete
		 * @param {boolean} [recursive=true] If true, will also search inherited contexts
		 * @returns {Namespace[]} The namespaces
		 */
		getPossibleNamespaces(incomplete, recursive = true) {
			const possibleNamespaces = new Map()
			this.namespaces.forEach((namespace) => {
				if (
					namespace.id.startsWith(incomplete) ||
					(namespace.shorthand && namespace.shorthand.startsWith(incomplete))
				)
					possibleNamespaces.set(namespace.id, namespace)
			})
			if (recursive && this.inheritedContext) {
				const inheritedNamespaces = this.inheritedContext.getPossibleNamespaces(incomplete)
				inheritedNamespaces.forEach((namespace) => {
					if (possibleNamespaces.has(namespace.id)) {
						const union = possibleNamespaces.get(namespace.id).createUnion(namespace)
						possibleNamespaces.set(namespace.id, union)
					} else {
						possibleNamespaces.set(namespace.id, namespace)
					}
				})
			}
			return [...possibleNamespaces.values()]
		}

		/**
		 * Returns any root tokens in this context who's ID starts with `incomplete`.
		 * @param {string} incomplete
		 * @param {boolean} [recursive=true] If true, will also search inherited contexts
		 * @returns {RootToken[]} The root tokens
		 */
		getPossibleRootTokens(incomplete, recursive = true) {
			const possibleRootTokens = []
			this.rootTokens.forEach((token) => {
				if (token.id.startsWith(incomplete)) possibleRootTokens.push(token)
			})
			if (recursive && this.inheritedContext) {
				return [
					...possibleRootTokens,
					...this.inheritedContext.getPossibleRootTokens(incomplete),
				]
			}
			return possibleRootTokens
		}

		/**
		 * Attempts to autocomplete the given text from the given position in the text
		 * @param {string} text The text to attempt to autocomplete
		 * @param {number} position The position of the cursor in the text
		 * @returns {MolangAutocompleteResult[]} The autocomplete results
		 */
		autocomplete(text, position) {
			const result = []
			const start = text
				.substring(0, position)
				.split(/[^a-zA-Z_.]\.*/g)
				.last()
				.toLowerCase()
			if (start.length === 0) return result
			const [space, dir] = start.split('.').slice(-2)

			const possibleRootTokens = this.getPossibleRootTokens(start)
			possibleRootTokens.forEach((token) => {
				result.push({
					text: token.arguments ? `${token.id}()` : token.id,
					label: token.arguments
						? `${token.id}( ${token.arguments.join(', ')} )`
						: undefined,
					overlap: start.length,
					priority: token.priority,
				})
			})

			const possibleNamespaces = this.getPossibleNamespaces(space)
			switch (possibleNamespaces.length) {
				default:
					possibleNamespaces.forEach((ns) => {
						result.push({ text: ns.id, overlap: space.length, priority: ns.priority })
						if (ns.shorthand)
							result.push({
								text: ns.shorthand,
								overlap: space.length,
								priority: ns.priority,
							})
					})
					return sortAutocompleteResults(result, start)
				case 0:
					return sortAutocompleteResults(result, start)
				case 1: {
					const namespace = possibleNamespaces[0]
					if (!dir && !start.endsWith('.')) {
						return sortAutocompleteResults(
							[
								...result,
								{
									text: namespace.id,
									overlap: space.length,
									priority: namespace.priority,
								},
							],
							start
						)
					}
					const possibleQueries = namespace.getPossibleQueries(text, dir)
					switch (possibleQueries.length) {
						default:
							return sortAutocompleteResults(
								[
									...result,
									...possibleQueries.map((q) => ({
										text: q.arguments ? `${q.id}()` : q.id,
										label: q.arguments
											? `${q.id}( ${q.arguments.join(', ')} )`
											: undefined,
										overlap: dir.length,
										priority: q.priority,
									})),
								],
								dir
							)
						case 0:
							return sortAutocompleteResults(result, start)
						case 1: {
							const query = possibleQueries[0]
							return sortAutocompleteResults(
								[
									...result,
									{
										text: query.arguments ? `${query.id}()` : query.id,
										label: query.arguments
											? `${query.id}( ${query.arguments.join(', ')} )`
											: undefined,
										overlap: dir.length,
										priority: query.priority,
									},
								],
								dir
							)
						}
					}
				}
			}
		}

		/**
		 * Removes the context from the list of all contexts
		 */
		delete() {
			MolangAutocomplete.Context.all.remove(this)
		}
	}

	MolangAutocomplete.DefaultContext = new MolangAutocomplete.Context({
		id: 'defaultContext',
	})
		.addRootToken({
			id: 'true',
		})
		.addRootToken({
			id: 'false',
		})
		.addRootToken({
			id: 'this',
		})
		.addRootToken({
			id: 'loop',
			arguments: ['count', 'expression'],
		})
		.addRootToken({
			id: 'return',
		})
		.addRootToken({
			id: 'break',
		})
		.addRootToken({
			id: 'continue',
		})
		.addNamespace(
			new MolangAutocomplete.Namespace({
				id: 'query',
				shorthand: 'q',
			})
				.addQuery({
					id: 'anim_time',
				})
				.addQuery({
					id: 'life_time',
				})

				.addQuery({
					id: 'camera_distance_range_lerp',
				})
				.addQuery({
					id: 'camera_rotation',
					arguments: ['axis'],
				})
				.addQuery({
					id: 'delta_time',
				})
				.addQuery({
					id: 'distance_from_camera',
				})
				.addQuery({
					id: 'get_default_bone_pivot',
				})
				.addQuery({
					id: 'lod_index',
				})
				.addQuery({
					id: 'model_scale',
				})
				.addQuery({
					id: 'rotation_to_camera',
					arguments: ['axis'],
				})
				.addQuery({
					id: 'time_stamp',
				})
		)
		.addNamespace(
			new MolangAutocomplete.Namespace({
				id: 'math',
				shorthand: 'm',
			})
				.addQuery({
					id: 'sin',
					arguments: ['value'],
				})
				.addQuery({
					id: 'cos',
					arguments: ['value'],
				})
				.addQuery({
					id: 'abs',
					arguments: ['value'],
				})
				.addQuery({
					id: 'clamp',
					arguments: ['value', 'min', 'max'],
				})
				.addQuery({
					id: 'pow',
					arguments: ['base', 'exponent'],
				})
				.addQuery({
					id: 'sqrt',
					arguments: ['value'],
				})
				.addQuery({
					id: 'random',
					arguments: ['low', 'high'],
				})
				.addQuery({
					id: 'random_integer',
					arguments: ['low', 'high'],
				})
				.addQuery({
					id: 'ceil',
					arguments: ['value'],
				})
				.addQuery({
					id: 'round',
					arguments: ['value'],
				})
				.addQuery({
					id: 'trunc',
					arguments: ['value'],
				})
				.addQuery({
					id: 'floor',
					arguments: ['value'],
				})
				.addQuery({
					id: 'mod',
					arguments: ['value', 'denominator'],
				})
				.addQuery({
					id: 'min',
					arguments: ['a', 'b'],
				})
				.addQuery({
					id: 'max',
					arguments: ['a', 'b'],
				})
				.addQuery({
					id: 'exp',
					arguments: ['value'],
				})
				.addQuery({
					id: 'ln',
					arguments: ['value'],
				})
				.addQuery({
					id: 'lerp',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'lerprotate',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'pi',
				})
				.addQuery({
					id: 'asin',
					arguments: ['value'],
				})
				.addQuery({
					id: 'acos',
					arguments: ['value'],
				})
				.addQuery({
					id: 'atan',
					arguments: ['value'],
				})
				.addQuery({
					id: 'atan2',
					arguments: ['y', 'x'],
				})
				.addQuery({
					id: 'die_roll',
					arguments: ['num', 'low', 'high'],
				})
				.addQuery({
					id: 'die_roll_integer',
					arguments: ['num', 'low', 'high'],
				})
				.addQuery({
					id: 'hermite_blend',
					arguments: ['0_to_1'],
				})
				.addQuery({
					id: 'min_angle',
					arguments: ['angle'],
				})
				.addQuery({
					id: 'sign',
					arguments: ['value'],
				})
				.addQuery({
					id: 'copy_sign',
					arguments: ['value', 'sign'],
				})
				.addQuery({
					id: 'inverse_lerp',
					arguments: ['start', 'end', 'value'],
				})
				.addQuery({
					id: 'ease_in_quad',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_out_quad',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_out_quad',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_cubic',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_out_cubic',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_out_cubic',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_quart',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_out_quart',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_out_quart',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_quint',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_out_quint',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_out_quint',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_sine',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_out_sine',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_out_sine',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_expo',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_out_expo',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_out_expo',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_circ',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_out_circ',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_out_circ',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_bounce',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_out_bounce',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_out_bounce',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_back',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_out_back',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_out_back',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_elastic',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_out_elastic',
					arguments: ['start', 'end', '0_to_1'],
				})
				.addQuery({
					id: 'ease_in_out_elastic',
					arguments: ['start', 'end', '0_to_1'],
				})

		)
		.addNamespace(
			new MolangAutocomplete.Namespace({
				id: 'variable',
				shorthand: 'v',
			})
				.addQueryGetter('variables', (_, incomplete) => {
					const variables = getProjectMolangVariables([incomplete])
					return [...variables].map((v) => ({ id: v }))
				})
		)
		.addNamespace(
			new MolangAutocomplete.Namespace({
				id: 'temp',
				shorthand: 't',
			}).addQueryGetter('temporary_variables', (expression, incomplete) => {
				const variables = getTemporaryMolangVariables(expression, [incomplete])
				return [...variables].map((v) => ({ id: v }))
			})
		)

	MolangAutocomplete.KeyframeContext = new MolangAutocomplete.Context({
		id: 'keyframeContext',
		inheritedContext: MolangAutocomplete.DefaultContext,
	})

	MolangAutocomplete.AnimationContext = new MolangAutocomplete.Context({
		id: 'animationContext',
		inheritedContext: MolangAutocomplete.DefaultContext,
	})

	MolangAutocomplete.VariablePlaceholdersContext = new MolangAutocomplete.Context({
		id: 'variablePlaceholdersContext',
		inheritedContext: MolangAutocomplete.DefaultContext,
	})
		.addRootToken({
			id: 'toggle',
			arguments: ['name'],
		})
		.addRootToken({
			id: 'slider',
			arguments: ['name', 'step?', 'min?', 'max?'],
		})
		.addRootToken({
			id: 'impulse',
			arguments: ['name', 'duration'],
		})
})()

Object.assign(window, {
	getAllMolangExpressions,
	MolangAutocomplete,
	getProjectMolangVariables,
	getTemporaryMolangVariables,
	sortAutocompleteResults,
})
