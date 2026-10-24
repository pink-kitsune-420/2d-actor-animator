interface Host { controller: AbortController; cancelGesture(): void; assembly: { pause(): void } }
export interface Section { id: string; label: string }

/** Presentation state only. Keep controls in their owning panel and retain
 * pending inputs, selection and source history when changing sections. */
export class FocusedSections {
  readonly nav: HTMLElement;
  private selected: string;
  private all = false;
  private readonly positions = new Map<string, number>();
  constructor(readonly root: HTMLElement, readonly scroller: HTMLElement, readonly host: Host,
    readonly sections: readonly Section[], readonly prefix: string) {
    this.selected = sections[0]!.id;
    this.nav = document.createElement('nav'); this.nav.className = 'section-navigation';
    this.nav.setAttribute('aria-label', `${prefix} sections`);
    for (const section of sections) {
      const button = document.createElement('button'); button.type = 'button';
      button.id = `section-${prefix.toLowerCase()}-${section.id}`; button.textContent = section.label;
      const controls: string[] = [];
      for (const [index, content] of [...root.querySelectorAll<HTMLElement>(`[data-workspace-section~="${section.id}"]`)].entries()) {
        if (!content.id) content.id = `${button.id}-content-${index}`;
        controls.push(content.id);
      }
      button.setAttribute('aria-controls', controls.join(' '));
      button.addEventListener('click', () => this.show(section.id), { signal: host.controller.signal });
      this.nav.append(button);
    }
    root.prepend(this.nav); this.render();
  }
  show(id: string) {
    if (!this.sections.some(section => section.id === id)) return;
    this.host.cancelGesture(); this.host.assembly.pause();
    this.positions.set(this.selected, this.scroller.scrollTop);
    this.selected = id; this.render(); this.scroller.scrollTop = this.positions.get(id) ?? 0;
    for (const content of this.root.querySelectorAll<HTMLElement>(`[data-workspace-section~="${id}"]`)) {
      // The section choice already expresses intent to see these tools. Keep
      // nested optional settings collapsed until explicitly requested.
      const disclosure = content instanceof HTMLDetailsElement ? content
        : content.childElementCount === 1 && content.firstElementChild instanceof HTMLDetailsElement ? content.firstElementChild : null;
      if (disclosure) disclosure.open = true;
    }
  }
  showAll(all: boolean) { this.all = all; this.render(); }
  private render() {
    this.nav.hidden = this.all;
    for (const content of this.root.querySelectorAll<HTMLElement>('[data-workspace-section]'))
      content.hidden = !this.all && !content.dataset.workspaceSection!.split(' ').includes(this.selected);
    for (const button of this.nav.querySelectorAll('button'))
      button.setAttribute('aria-pressed', String(button.id.endsWith(`-${this.selected}`)));
  }
}
