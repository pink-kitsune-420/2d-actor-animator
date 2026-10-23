import type { ActorCurve } from '@actor-animator/types';
import { ACTOR_CURVES } from '../../../../packages/actor-tools/src';
import type { ActorDraft } from './editing';
import type { ActorPreview } from './preview';
import { controls, controlAt, CurveEdit, curvePath, effectiveCurve, fitControls, plotPoint, segment, type Controls, type SegmentRef, type YRange } from './curve-model';
interface Host { draft: ActorDraft; controller: AbortController; perform(f: () => void): void; changed(): void; cancelGesture(): void; message(s: string): void }
type Drag = { id: number; handle: number; edit: CurveEdit; b: Controls; range: YRange; rect: DOMRect; identity: string; startX: number; startY: number; moved: boolean };
/** Authored easing only. Cached SVG geometry; the existing clock moves one line. */
export class CurveEditor {
  private ref: SegmentRef | null = null;
  private stamp = '';
  private b: Controls = [0, 0, 1, 1];
  private range: YRange = { lo: -.1, hi: 1.1 };
  private drag: Drag | null = null;
  private observer: ResizeObserver;
  private disposed = false;
  private svg: SVGSVGElement;
  constructor(readonly root: HTMLElement, readonly host: Host, readonly preview: ActorPreview, readonly selected: () => SegmentRef | null) {
    root.innerHTML = `<h3>Outgoing easing</h3><p>Raw authored progress for all five local TRS components. Preview can blend layers and solve constraints; this graph does not bake that output.</p><output id="curve-segment"></output>
      <div class="curve-surface"><svg id="curve-graph" viewBox="0 0 400 280" preserveAspectRatio="none" role="group" aria-label="Outgoing easing graph">
      <path id="curve-grid"/><path id="curve-tangents"/><path id="curve-path"/><line id="curve-cursor" y1="24" y2="228"/>
      <text x="48" y="249">0</text><text x="342" y="249">1</text><text x="95" y="272">Normalized elapsed time →</text><text x="8" y="16">Eased progress ↑</text><text id="curve-y-high" x="2" y="34"/><text id="curve-y-low" x="2" y="228"/></svg>
      <div id="curve-handles"><button id="curve-h1" aria-label="Bézier handle 1">1</button><button id="curve-h2" aria-label="Bézier handle 2">2</button></div></div>
      <output id="curve-clock"></output><pre id="curve-endpoints"></pre>
      <label>Curve only<select id="curve-choice"><option>track-default</option>${ACTOR_CURVES.map(c=>`<option>${c}</option>`).join('')}</select></label>
      <nav><button id="curve-apply">Apply curve only</button><button id="curve-custom">Convert shown curve to custom</button></nav>
      <div class="curve-numbers">${['x1','y1','x2','y2'].map((n,i)=>`<label>${n}<input id="curve-b${i}" type="number" step="any"${i%2===0?' min="0" max="1"':''}></label>`).join('')}</div><button id="curve-controls-apply">Apply custom controls only</button>
      <p>Handles: arrows change 0.01, Shift 0.1; Escape cancels a drag. X stays in [0,1]; Y may overshoot. Drag within the fitted graph, or enter any finite Y numerically. Convert explicitly before moving preset handles. Only this selected segment changes.</p><output id="curve-status" role="status"></output>`;
    this.svg = this.el<SVGSVGElement>('curve-graph');
    const signal = host.controller.signal;
    const click = (id: string, f: () => void) => this.el(id).addEventListener('click', () => host.perform(() => { host.cancelGesture(); preview.pause(); f(); }), { signal });
    click('curve-apply', () => { const c = this.el<HTMLSelectElement>('curve-choice').value; this.apply(c === 'track-default' ? undefined : c as ActorCurve, c === 'cubic-bezier' ? this.numbers() : undefined); });
    click('curve-custom', () => this.apply('cubic-bezier', this.b));
    click('curve-controls-apply', () => this.apply('cubic-bezier', this.numbers()));
    for (let i=0;i<2;i++) {
      const h=this.el(`curve-h${i+1}`);
      h.addEventListener('pointerdown', e=>host.perform(()=>this.down(e,i)),{signal});
      h.addEventListener('pointermove', e=>host.perform(()=>this.motion(e)),{signal});
      h.addEventListener('pointerup', e=>host.perform(()=>this.up(e)),{signal});
      for (const t of ['pointercancel','lostpointercapture'] as const) h.addEventListener(t,e=>{if(e.pointerId===this.drag?.id)this.cancel();},{signal});
      h.addEventListener('keydown', e=>host.perform(()=>{
        if(e.key==='Escape'){this.cancel();return;}
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
        e.preventDefault();host.cancelGesture();preview.pause();const b=[...this.b] as Controls, axis=e.key==='ArrowLeft'||e.key==='ArrowRight'?0:1;
        b[i*2+axis]!+=(e.key==='ArrowLeft'||e.key==='ArrowDown'?-1:1)*(e.shiftKey?.1:.01);
        b[i*2]=Math.max(0,Math.min(1,b[i*2]!));this.apply('cubic-bezier',b);h.focus({preventScroll:true});
      }),{signal});
    }
    document.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancel();},{signal});
    document.addEventListener('pointerdown',e=>{if(!(e.target as Element).closest('#curve-handles'))this.cancel();},{capture:true,signal});
    document.addEventListener('focusin',e=>{if(!(e.target as Element).closest('#curve-handles'))this.cancel();},{signal});
    document.addEventListener('change',()=>this.cancel(),{capture:true,signal});
    document.addEventListener('scroll',()=>this.cancel(),{capture:true,signal});
    window.addEventListener('resize',()=>this.cancel(),{signal});
    this.observer=new ResizeObserver(()=>this.cancel());this.observer.observe(this.svg);
  }
  private el<T extends Element = HTMLElement>(id: string) { return this.root.querySelector<T>(`#${id}`)!; }
  private numbers(): Controls { return [0,1,2,3].map(i=>{const text=this.el<HTMLInputElement>(`curve-b${i}`).value;if(!text.trim())throw new Error('Enter four finite controls.');return Number(text);}) as Controls; }
  private identity() { return JSON.stringify([this.host.draft.epoch,this.selected()]); }
  render() {
    if(this.disposed)return;
    const stamp=this.identity();if(stamp===this.stamp){this.time();return;}this.cancel();this.stamp=stamp;this.ref=this.selected();
    let info: ReturnType<typeof segment> | null=null;
    if(this.ref){try{info=segment(this.host.draft.source,this.ref);}catch{this.ref=null;}}
    const enabled=!!info;
    for(const el of this.root.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('button,input,select'))el.disabled=!enabled;
    this.el('curve-segment').textContent=info&&this.ref?`${this.ref.time} → ${this.ref.next} seconds · ${info.key.curve??`inherited ${info.track.interpolation}`} · ${info.track.angle??'legacy unwrapped'} · extra turns ${info.key.turns??0}`:'Select a transform key with a following key. Last-key metadata is inert; no outgoing segment is editable.';
    this.el('curve-endpoints').textContent=info?`Start ${JSON.stringify(info.key.value)}\nEnd   ${JSON.stringify(info.end.value)}\nx/y: project units · rotation: CCW radians · scales: dimensionless`:'No outgoing segment.';
    this.svg.style.visibility=enabled?'visible':'hidden';
    if(info){const curve=effectiveCurve(info.track,info.key);this.b=controls(curve,info.key);this.range=fitControls(this.b);this.el<HTMLSelectElement>('curve-choice').value=info.key.curve??'track-default';
      this.paint(curve,this.b,this.range);for(let i=0;i<4;i++)this.el<HTMLInputElement>(`curve-b${i}`).value=String(this.b[i]);
      for(let i=1;i<=2;i++)this.el<HTMLButtonElement>(`curve-h${i}`).disabled=info.key.curve!=='cubic-bezier';
    } else { for(let i=1;i<=2;i++)this.el<HTMLElement>(`curve-h${i}`).hidden=true; }
    this.time();
  }
  private paint(curve:string,b:Controls,r:YRange) {
    this.el('curve-path').setAttribute('d',curvePath(curve,b,r));const a=plotPoint(0,0,r),z=plotPoint(1,1,r),c=plotPoint(b[0],b[1],r),d=plotPoint(b[2],b[3],r);
    this.el('curve-grid').setAttribute('d',`M48,24 V228 H352 M48,${a.y} H352 M48,${z.y} H352`);
    this.el('curve-tangents').setAttribute('d',curve==='cubic-bezier'?`M${a.x},${a.y} L${c.x},${c.y} M${z.x},${z.y} L${d.x},${d.y}`:'');
    this.el('curve-y-high').textContent=r.hi.toPrecision(3);this.el('curve-y-low').textContent=r.lo.toPrecision(3);
    for(let i=0;i<2;i++){const p=i===0?c:d,h=this.el<HTMLElement>(`curve-h${i+1}`);h.hidden=curve!=='cubic-bezier';h.style.left=`${p.x/4}%`;h.style.top=`${p.y/2.8}%`;h.setAttribute('aria-label',`Bézier handle ${i+1}: x ${b[i*2]}, y ${b[i*2+1]}`);}
  }
  time() {
    if(this.disposed)return;
    const single=!!this.ref&&this.preview.clipId===this.ref.clipId,t=this.preview.clipTime(),u=this.ref?(t-this.ref.time)/(this.ref.next-this.ref.time):0;
    const cursor=this.el('curve-cursor');cursor.setAttribute('x1',String(48+304*u));cursor.setAttribute('x2',String(48+304*u));cursor.setAttribute('visibility',single&&u>=0&&u<=1?'visible':'hidden');
    this.el('curve-clock').textContent=single?`Single clip · ${t.toFixed(4)} s · raw easing graph; preview may solve constraints`:`Animator or rest preview · clock ${this.preview.currentTime.toFixed(4)} s · graph remains raw authored easing`;
  }
  private apply(curve:ActorCurve|undefined,b?:Controls) { const ref=this.selected();if(!ref)throw new Error('Select an outgoing transform segment.');if(new CurveEdit(this.host.draft,ref).finish(curve,b)){this.host.changed();this.host.message('Changed only the selected outgoing curve in one source transaction.');}this.render(); }
  private down(e:PointerEvent,handle:number) {
    if(e.button!==0||this.drag||!this.ref)return;
    this.host.cancelGesture();this.preview.pause();e.preventDefault();const h=this.el<HTMLElement>(`curve-h${handle+1}`);h.focus({preventScroll:true});
    this.drag={id:e.pointerId,handle,edit:new CurveEdit(this.host.draft,this.ref),b:[...this.b],range:{...this.range},rect:this.svg.getBoundingClientRect(),identity:this.identity(),startX:e.clientX,startY:e.clientY,moved:false};h.setPointerCapture(e.pointerId);
  }
  private motion(e:PointerEvent) {
    const p=this.drag;if(!p||p.id!==e.pointerId)return;const r=this.svg.getBoundingClientRect();
    if(p.identity!==this.identity()||r.x!==p.rect.x||r.y!==p.rect.y||r.width!==p.rect.width||r.height!==p.rect.height){this.cancel();return;}
    if(e.clientX===p.startX&&e.clientY===p.startY&&!p.moved)return;p.moved=true;
    const c=controlAt(p.rect,e.clientX,e.clientY,p.range);p.b[p.handle*2]=c.x;p.b[p.handle*2+1]=c.y;this.paint('cubic-bezier',p.b,p.range);
    this.el('curve-status').textContent=`Staged controls ${p.b.join(', ')} · release to commit; Escape cancels.`;
  }
  private release(p:Drag){const h=this.el<HTMLElement>(`curve-h${p.handle+1}`);if(h.hasPointerCapture(p.id))h.releasePointerCapture(p.id);}
  private up(e:PointerEvent){if(e.pointerId!==this.drag?.id)return;this.motion(e);const p=this.drag;if(!p)return;this.drag=null;this.release(p);if(p.moved&&p.edit.finish('cubic-bezier',p.b)){this.host.changed();this.host.message('Changed only the selected outgoing curve in one source transaction.');}this.el('curve-status').textContent='';this.render();}
  cancel(){const p=this.drag;if(!p)return;this.drag=null;p.edit.cancel();this.release(p);this.paint('cubic-bezier',this.b,this.range);this.el('curve-status').textContent='Curve gesture cancelled; source unchanged.';}
  dispose(){this.cancel();this.disposed=true;this.observer.disconnect();}
}
