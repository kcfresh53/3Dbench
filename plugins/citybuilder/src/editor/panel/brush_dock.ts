import type { CityController } from '../controller';
import type { LandscapeMode } from '../tools/models';

/** Small viewport-local dock; sidebar controls remain available for precise edits. */
export class BrushDock {
	private readonly root=document.createElement('div');
	private readonly tools=document.createElement('div');
	private readonly options=document.createElement('div');
	private readonly off:()=>void;
	private readonly timer:ReturnType<typeof setInterval>;
	private collapsed=false;
	private last='';
	constructor(private readonly ctl:CityController) {
		this.root.className='city_brush_dock';this.root.setAttribute('aria-label','City tools');
		this.root.append(this.tools,this.options);
		for(const event of ['pointerdown','pointerup','click','wheel'])this.root.addEventListener(event,e=>e.stopPropagation());
		this.off=ctl.changed.on(()=>this.update());
		this.timer=setInterval(()=>this.attach(),400);
		this.attach();this.update();
	}
	private attach():void {
		const host=Preview.selected?.canvas?.parentElement;
		if(host&&this.root.parentElement!==host)host.append(this.root);
		this.root.hidden=!this.ctl.store.state || !Modes.edit;
	}
	private button(label:string,action:()=>void,active=false):HTMLButtonElement {
		const b=document.createElement('button');b.type='button';b.textContent=label;b.title=label;
		b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));b.onclick=action;return b;
	}
	private update():void {
		this.attach();
		const c=this.ctl;
		const active=c.landscapeTool.active?'landscape':c.districtTool.active?'zoning':'none';
		const signature=JSON.stringify([active,c.landscape,c.district,this.collapsed,c.busy]);
		if(signature===this.last)return;this.last=signature;
		this.tools.replaceChildren();this.options.replaceChildren();
		this.tools.append(this.button(this.collapsed?'City tools ▴':'▾',()=>{this.collapsed=!this.collapsed;this.update();}));
		if(this.collapsed)return;
		this.tools.append(this.button('Select',()=>{(BarItems.move_tool as Tool).select();this.last='';this.update();},active==='none'));
		for(const [id,label] of [['raise','Raise'],['lower','Lower'],['smooth','Smooth'],['flatten','Flatten'],['level','Level'],['surface','Biome']] as [LandscapeMode,string][])
			this.tools.append(this.button(label,()=>c.pickLandscape(id),active==='landscape'&&c.landscape.mode===id));
		this.tools.append(this.button('District',()=>c.pickDistrictMode('brush'),active==='zoning'));
		this.tools.append(this.button('Road',()=>c.drawRoads()));
		if(active==='none')return;
		const select=document.createElement('select');select.setAttribute('aria-label',active==='zoning'?'District':'Brush shape');
		if(active==='zoning') {
			for(const d of c.districts)select.add(new Option(d.label,String(d.id)));
			select.value=String(c.district.id);select.onchange=()=>c.pickDistrictType(Number(select.value));
			this.options.append(select,this.button('Erase',()=>c.pickDistrictMode('erase'),c.district.mode==='erase'));
		} else if(c.landscape.mode==='surface') {
			select.setAttribute('aria-label','Biome');for(const s of c.surfaces)select.add(new Option(s.label,String(s.id)));
			select.add(new Option('Automatic','0'));select.value=String(c.landscape.surface);select.onchange=()=>c.setLandscape('surface',Number(select.value));this.options.append(select);
		}
		const radius=document.createElement('input');radius.type='range';radius.min='4';radius.max='300';radius.step='1';radius.setAttribute('aria-label','Brush radius');
		radius.value=String(active==='zoning'?c.district.radius:c.landscape.brush.radius);
		const label=document.createElement('label');label.textContent=`Radius ${radius.value} m `;label.append(radius);
		radius.onchange=()=>active==='zoning'?c.setDistrict('radius',Number(radius.value)):c.setLandscape('brush.radius',Number(radius.value));
		this.options.append(label);
		if(active==='landscape'&&c.landscape.mode!=='surface') {
			const strength=document.createElement('input');strength.type='number';strength.min='.02';strength.max='1';strength.step='.02';strength.value=String(c.landscape.brush.strength);strength.setAttribute('aria-label','Brush strength');
			strength.onchange=()=>c.setLandscape('brush.strength',Math.max(.02,Math.min(1,Number(strength.value)||.02)));
			const l=document.createElement('label');l.textContent='Strength ';l.append(strength);this.options.append(l);
		}
	}
	dispose():void {this.off();clearInterval(this.timer);this.root.remove();}
}
export const BRUSH_DOCK_CSS=`.city_brush_dock{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:12;width:max-content;max-width:calc(100% - 32px);padding:6px;background:var(--color-back);color:var(--color-text);border:1px solid var(--color-border);border-radius:12px;box-shadow:0 4px 20px #0006;pointer-events:auto}.city_brush_dock[hidden]{display:none}.city_brush_dock>div{display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:wrap}.city_brush_dock>div+div:not(:empty){margin-top:6px}.city_brush_dock button{min-width:0;min-height:0;height:auto;line-height:24px;font-size:12px;padding:3px 9px;border-radius:6px}.city_brush_dock button.active{background:var(--color-accent);color:var(--color-accent_text)}.city_brush_dock input[type=range]{width:100px;vertical-align:middle}.city_brush_dock input[type=number]{width:60px}.city_brush_dock select{max-width:160px}`;
