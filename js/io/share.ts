import { Blockbench } from "../api";
import { Dialog } from "../interface/dialog";
import { FormInputType } from "../interface/form";
import { settings } from "../interface/settings";
import { BARS } from "../interface/toolbars";
import { tl } from "../languages";
import { Mesh } from "../outliner/types/mesh";
import { Outliner } from "../outliner/outliner";
import { ReferenceImage } from "../preview/reference_images";
import { capitalizeFirstLetter } from "../util/util";
import { Codecs } from "./codec";

BARS.defineActions(function() {
	function uploadSketchfabModel() {
		if (Outliner.elements.length === 0 || !Format) {
			return;
		}
		let tag_suggestions = ['low-poly', 'pixel-art', 'NoAI'];
		if (!Mesh.all.length) tag_suggestions.push('voxel');
		let clean_project_name = Project.name.toLowerCase().replace(/[_.-]+/g, '-').replace(/[^a-z0-9-]+/, '').replace(/-geo/, '');
		if (Project.name) tag_suggestions.push(clean_project_name);
		if (clean_project_name.includes('-')) tag_suggestions.safePush(...clean_project_name.split('-').filter(s => s.length > 2 && s != 'geo').reverse());
	
		let categories = {
			"": "-",
			"animals-pets": "Animals & Pets",
			"architecture": "Architecture",
			"art-abstract": "Art & Abstract",
			"cars-vehicles": "Cars & Vehicles",
			"characters-creatures": "Characters & Creatures",
			"cultural-heritage-history": "Cultural Heritage & History",
			"electronics-gadgets": "Electronics & Gadgets",
			"fashion-style": "Fashion & Style",
			"food-drink": "Food & Drink",
			"furniture-home": "Furniture & Home",
			"music": "Music",
			"nature-plants": "Nature & Plants",
			"news-politics": "News & Politics",
			"people": "People",
			"places-travel": "Places & Travel",
			"science-technology": "Science & Technology",
			"sports-fitness": "Sports & Fitness",
			"weapons-military": "Weapons & Military",
		}
	
		var dialog = new Dialog('sketchfab_uploader', {
			title: 'dialog.sketchfab_uploader.title',
			width: 640,
			form: {
				token: {label: 'dialog.sketchfab_uploader.token', value: settings.sketchfab_token.value, type: 'password'},
				about_token: {type: 'info', text: tl('dialog.sketchfab_uploader.about_token', ['[sketchfab.com/settings/password](https://sketchfab.com/settings/password)'])},
				name: {label: 'dialog.sketchfab_uploader.name', value: capitalizeFirstLetter(Project.name.replace(/\..+/, '').replace(/[_.-]/g, ' '))},
				description: {label: 'dialog.sketchfab_uploader.description', type: 'textarea'},
				category1: {label: 'dialog.sketchfab_uploader.category', type: 'select', options: categories, value: ''},
				category2: {label: 'dialog.sketchfab_uploader.category2', type: 'select', options: categories, value: ''},
				tags: {label: 'dialog.sketchfab_uploader.tags', placeholder: 'Tag1 Tag2'},
				tag_suggestions: {label: 'dialog.sketchfab_uploader.suggested_tags', type: 'buttons', buttons: tag_suggestions, click(index) {
					let {tags} = dialog.getFormResult();
					let new_tag = tag_suggestions[index];
					if (!(tags as string).split(/\s/g).includes(new_tag)) {
						tags += ' ' + new_tag;
						dialog.setFormValues({tags});
					}
				}},
				animations: {label: 'dialog.sketchfab_uploader.animations', value: true, type: 'checkbox', condition: (Format.animation_mode && !!Animator.animations.length)},
				draft: {label: 'dialog.sketchfab_uploader.draft', type: 'checkbox', value: true},
				divider: '_',
				private: {label: 'dialog.sketchfab_uploader.private', type: 'checkbox'},
				password: {label: 'dialog.sketchfab_uploader.password', type: 'password'},
			},
			onConfirm(formResult) {
	
				if (!formResult.token || !formResult.name) {
					Blockbench.showQuickMessage('message.sketchfab.name_or_token', 1800)
					return;
				}
				if (!(formResult.tags as string).split(' ').includes('blockbench')) {
					formResult.tags += ' blockbench';
				}
				var data = new FormData()
				data.append('token', formResult.token as string)
				data.append('name', formResult.name as string)
				data.append('description', formResult.description as string)
				data.append('tags', formResult.tags as string)
				data.append('isPublished', (!formResult.draft as boolean).toString())
				//data.append('background', JSON.stringify({color: '#00ff00'}))
				data.append('private', (formResult.private as boolean).toString())
				data.append('password', formResult.password as string)
				data.append('source', 'blockbench')
	
				if (formResult.category1 || formResult.category2) {
					let selected_categories: string[] = [];
					if (formResult.category1) selected_categories.push(formResult.category1 as string);
					if (formResult.category2) selected_categories.push(formResult.category2 as string);
					data.append('categories', selected_categories.join(' '));
				}
	
				settings.sketchfab_token.set(formResult.token);
	
				Codecs.gltf.compile({animations: formResult.animations}).then(content => {
	
					var blob = new Blob([content], {type: "text/plain;charset=utf-8"});
					var file = new File([blob], 'model.gltf')
	
					data.append('modelFile', file)
	
					$.ajax({
						url: 'https://api.sketchfab.com/v3/models',
						data,
						cache: false,
						contentType: false,
						processData: false,
						type: 'POST',
						success: function(response) {
							let url = `https://sketchfab.com/models/${response.uid}`
							new Dialog('sketchfab_link', {
								title: tl('message.sketchfab.success'),
								icon: 'icon-sketchfab',
								singleButton: true,
								form: {
									message: {type: 'info', text: `[${formResult.name} on Sketchfab](${url})`},
									link: {type: 'text', value: url, readonly: true, share_text: true}
								}
							}).show();
						},
						error: function(response) {
							let response_types = {
								[400]: 'Bad Request',
								[401]: 'Unauthorized',
								[403]: 'Forbidden',
								[404]: 'Not Found',
								[405]: 'Method Not Allowed',
								[406]: 'Not Acceptable',
								[407]: 'Proxy Authentication Required',
								[408]: 'Request Timeout',
								[415]: 'Unsupported File Type',
							}
							Blockbench.showQuickMessage(tl('message.sketchfab.error') + `: Error ${response.status} - ${response_types[response.status]||''}`, 1500)
							console.error(response);
						}
					})
				})
	
				dialog.hide()
			}
		})
		dialog.show()
	}
	new Action('upload_sketchfab', {
		icon: 'icon-sketchfab',
		category: 'file',
		condition: () => Project && !!Outliner.elements.length,
		click() {
			uploadSketchfabModel()
		}
	})
})