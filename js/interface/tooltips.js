// Keep the original label node attached to its owner: names, keybindings, theme
// inheritance and Vue updates continue to work while it is in the top layer.
export function setupTooltips() {
	let active, owner, frame, touchTimer, touchHideTimer;
	const findOwner = target => target instanceof Element && target.closest('.tool, .timeline_marker');
	function hide() {
		clearTimeout(touchTimer);
		clearTimeout(touchHideTimer);
		cancelAnimationFrame(frame);
		if (active?.matches(':popover-open')) active.hidePopover();
		active = owner = null;
	}
	function position() {
		if (!owner?.isConnected || !active?.isConnected || owner.closest('.menu_open') || !owner.getClientRects().length) {
			hide();
			return;
		}
		const anchor = owner.getBoundingClientRect();
		const box = active.getBoundingClientRect();
		const description = active.querySelector('.tooltip_description')?.getBoundingClientRect();
		const width = Math.max(box.width, description?.width || 0);
		const height = box.height + (description ? description.height + 4 : 0);
		let left = anchor.left, top = anchor.bottom + 4;
		if (owner.closest('.vertical')) {
			left = anchor.left > innerWidth / 2 ? anchor.left - width - 4 : anchor.right + 4;
			top = anchor.top;
		} else if (owner.matches('.timeline_marker') || top + height > innerHeight - 8) {
			top = anchor.top - height - 4;
		}
		active.style.left = Math.max(8, Math.min(left, innerWidth - width - 8)) + 'px';
		active.style.top = Math.max(8, Math.min(top, innerHeight - height - 8)) + 'px';
		frame = requestAnimationFrame(position);
	}
	function show(next) {
		hide();
		if (!next || next.closest('.menu_open, .dialog_bar.form_bar')) return;
		const tooltip = next.querySelector(':scope > .tooltip');
		if (!tooltip || tooltip.style.display === 'none') return;
		owner = next;
		active = tooltip;
		active.setAttribute('popover', 'manual');
		active.showPopover();
		position();
	}
	document.addEventListener('pointerover', event => {
		if (event.pointerType === 'touch') return;
		const next = findOwner(event.target);
		if (next && next !== findOwner(event.relatedTarget)) show(next);
	});
	document.addEventListener('pointerout', event => {
		if (owner && findOwner(event.relatedTarget) !== owner) hide();
	});
	document.addEventListener('pointerdown', event => {
		hide();
		if (event.pointerType === 'touch') {
			const next = findOwner(event.target);
			touchTimer = setTimeout(() => {
				show(next);
				touchHideTimer = setTimeout(hide, 1200);
			}, 500);
		}
	});
	document.addEventListener('pointerup', () => clearTimeout(touchTimer));
	document.addEventListener('pointercancel', hide);
	document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
	document.addEventListener('scroll', hide, true);
	window.addEventListener('blur', hide);
	window.addEventListener('resize', hide);
}
