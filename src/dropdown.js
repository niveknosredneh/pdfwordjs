export class CustomDropdown {
    constructor(selectEl) {
        this.select = selectEl;
        this._build();
        this._bindEvents();
        this._observer = new MutationObserver(() => this.sync());
        this._observer.observe(this.select, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['disabled']
        });
        this.sync();
    }

    _build() {
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'custom-dropdown';
        if (this.select.id) this.wrapper.dataset.for = this.select.id;

        this.trigger = document.createElement('button');
        this.trigger.className = 'custom-dropdown-trigger';
        this.trigger.type = 'button';
        this.trigger.setAttribute('aria-haspopup', 'listbox');

        this.menu = document.createElement('div');
        this.menu.className = 'custom-dropdown-menu';
        this.menu.setAttribute('role', 'listbox');

        this.select.style.display = 'none';
        this.select.parentNode.insertBefore(this.wrapper, this.select);
        this.wrapper.appendChild(this.trigger);
        this.wrapper.appendChild(this.menu);
        this.wrapper.appendChild(this.select);
    }

    _bindEvents() {
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.select.disabled) return;
            this.toggle();
        });

        this.menu.addEventListener('click', (e) => {
            const item = e.target.closest('.custom-dropdown-item');
            if (!item) return;
            const value = item.dataset.value;
            if (value !== undefined) {
                this._selectValue(value);
            }
            this.close();
        });

        this._onKeyDown = this._onKeyDown.bind(this);
        this.menu.addEventListener('keydown', this._onKeyDown);

        this._onDocumentClick = (e) => {
            if (!this.wrapper.contains(e.target)) {
                this.close();
            }
        };
    }

    _onKeyDown(e) {
        const items = [...this.menu.querySelectorAll('.custom-dropdown-item')];
        const currentIndex = items.indexOf(document.activeElement);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                const next = currentIndex + 1;
                if (next < items.length) items[next].focus();
                else items[0]?.focus();
                break;
            case 'ArrowUp':
                e.preventDefault();
                const prev = currentIndex - 1;
                if (prev >= 0) items[prev].focus();
                else items[items.length - 1]?.focus();
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (document.activeElement?.classList.contains('custom-dropdown-item')) {
                    this._selectValue(document.activeElement.dataset.value);
                    this.close();
                }
                break;
            case 'Tab':
                this.trigger.focus();
                this.close();
                break;
            case 'Escape':
                e.preventDefault();
                this.close();
                this.trigger.focus();
                break;
            case 'Home':
                e.preventDefault();
                items[0]?.focus();
                break;
            case 'End':
                e.preventDefault();
                items[items.length - 1]?.focus();
                break;
        }
    }

    _selectValue(value) {
        this.select.value = value;
        this.select.dispatchEvent(new Event('change', { bubbles: true }));
        this._updateTriggerText();
    }

    _updateTriggerText() {
        const selectedOpt = this.select.options[this.select.selectedIndex];
        this.trigger.textContent = selectedOpt ? selectedOpt.textContent : '';
        this._appendArrow();
    }

    _appendArrow() {
        const arrow = document.createElement('span');
        arrow.className = 'custom-dropdown-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        this.trigger.appendChild(arrow);
    }

    _updateDisabled() {
        if (this.select.disabled) {
            this.wrapper.classList.add('disabled');
            this.trigger.tabIndex = -1;
        } else {
            this.wrapper.classList.remove('disabled');
            this.trigger.tabIndex = 0;
        }
    }

    sync() {
        this.menu.innerHTML = '';
        const options = [...this.select.options];
        if (options.length === 0) {
            this.trigger.textContent = '';
            this._appendArrow();
            this._updateDisabled();
            return;
        }

        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const item = document.createElement('div');
            item.className = 'custom-dropdown-item';
            item.setAttribute('role', 'option');
            item.dataset.value = opt.value;
            item.textContent = opt.textContent;
            if (opt.selected || i === this.select.selectedIndex) {
                item.classList.add('selected');
                item.setAttribute('aria-selected', 'true');
            }
            if (opt.disabled) {
                item.classList.add('disabled');
                item.setAttribute('aria-disabled', 'true');
            }
            this.menu.appendChild(item);
        }

        this._updateTriggerText();
        this._updateDisabled();
    }

    open() {
        if (this.select.disabled || this.select.options.length === 0) return;
        if (this.menu.classList.contains('open')) return;

        this.menu.classList.add('open');
        this.wrapper.classList.add('open');
        this.trigger.setAttribute('aria-expanded', 'true');

        const rect = this.wrapper.getBoundingClientRect();
        const menuHeight = this.menu.offsetHeight;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;

        this.menu.style.position = 'fixed';
        this.menu.style.left = rect.left + 'px';
        this.menu.style.minWidth = rect.width + 'px';

        if (spaceBelow < menuHeight && spaceAbove > menuHeight) {
            this.menu.classList.add('flip-up');
            this.menu.style.top = 'auto';
            this.menu.style.bottom = (window.innerHeight - rect.top) + 'px';
        } else {
            this.menu.classList.remove('flip-up');
            this.menu.style.top = rect.bottom + 'px';
            this.menu.style.bottom = 'auto';
        }

        const firstItem = this.menu.querySelector('.custom-dropdown-item');
        if (firstItem) firstItem.focus();

        document.addEventListener('click', this._onDocumentClick);
    }

    close() {
        if (!this.menu.classList.contains('open')) return;
        this.menu.classList.remove('open');
        this.wrapper.classList.remove('open');
        this.trigger.removeAttribute('aria-expanded');
        this.menu.style.position = '';
        this.menu.style.left = '';
        this.menu.style.top = '';
        this.menu.style.bottom = '';
        this.menu.style.minWidth = '';
        document.removeEventListener('click', this._onDocumentClick);
    }

    toggle() {
        if (this.menu.classList.contains('open')) {
            this.close();
        } else {
            this.open();
        }
    }

    destroy() {
        this._observer.disconnect();
        document.removeEventListener('click', this._onDocumentClick);
        this.select.style.display = '';
        this.wrapper.replaceWith(this.select);
    }
}
