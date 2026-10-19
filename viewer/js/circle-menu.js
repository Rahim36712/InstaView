/** Accessible, dependency-free adaptation of the supplied circular action menu. */
(function (root) {
  'use strict';
  class CircleMenu {
    constructor(container, items) {
      this.container = container;
      this.items = items;
      this.open = false;
      container.className = 'circle-menu';
      const trigger = document.createElement('button');
      trigger.type = 'button'; trigger.className = 'circle-menu-trigger';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', 'circle-menu-panel');
      trigger.setAttribute('aria-label', 'Open quick actions');
      trigger.title = 'Quick actions';
      trigger.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
      this.trigger = trigger;
      const panel = document.createElement('div');
      panel.id = 'circle-menu-panel'; panel.className = 'circle-menu-panel'; panel.hidden = true;
      panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'Quick actions');
      const center = document.createElement('button');
      center.type = 'button'; center.className = 'circle-menu-center';
      center.setAttribute('aria-label', 'Close quick actions'); center.textContent = '×';
      center.addEventListener('click', () => this.toggle(false));
      panel.appendChild(center);
      this.buttons = items.map((item, index) => {
        const angle = 2 * Math.PI * index / items.length - Math.PI / 2;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'circle-menu-item';
        button.style.setProperty('--circle-x', `${106 * Math.cos(angle)}px`);
        button.style.setProperty('--circle-y', `${106 * Math.sin(angle)}px`);
        button.style.setProperty('--circle-order', index);
        button.setAttribute('aria-label', item.label);
        const icon = document.createElement('span'); icon.className = 'circle-menu-icon';
        if (item.icon) icon.appendChild(item.icon.cloneNode(true)); else icon.textContent = item.symbol || '•';
        const label = document.createElement('span'); label.className = 'circle-menu-label'; label.textContent = item.label;
        button.append(icon, label);
        button.addEventListener('click', () => {
          this.toggle(false, false);
          item.action();
        });
        panel.appendChild(button);
        return button;
      });
      this.panel = panel;
      container.append(trigger, panel);
      trigger.addEventListener('click', () => this.toggle(!this.open));
      document.addEventListener('pointerdown', event => {
        if (this.open && !container.contains(event.target)) this.toggle(false, false);
      });
      container.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.toggle(false); }
        const offset = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (offset && this.open) {
          event.preventDefault();
          event.stopPropagation();
          const index = this.buttons.indexOf(document.activeElement);
          this.buttons[(index + offset + this.buttons.length) % this.buttons.length].focus();
        }
      });
    }
    toggle(open, restoreFocus = true) {
      this.open = open;
      this.trigger.setAttribute('aria-expanded', String(open));
      this.trigger.setAttribute('aria-label', open ? 'Close quick actions' : 'Open quick actions');
      this.panel.hidden = !open;
      this.container.classList.toggle('is-open', open);
      if (open) this.buttons[0]?.focus();
      else if (restoreFocus) this.trigger.focus();
    }
  }
  root.CircleMenu = CircleMenu;
})(window);
