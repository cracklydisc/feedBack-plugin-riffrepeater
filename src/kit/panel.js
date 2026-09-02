/*
 * kit 0.3.0 — the parked panel, and the button in the player that opens it.
 *
 * Two plugins wrote this before it lived here: Riff Repeater (155 lines) and
 * Live Tab (~410 lines across `mountControls`, `panelCSS` and
 * `repaintControls`). Both arrived at the same corner, one of them after two
 * bug reports.
 *
 * WHAT IT OBEYS (core's docs/plugin-v3-ui.md):
 *
 *   - append to `feedBack.ui.playerControlSlot()`, never `#player-controls` —
 *     the transport auto-hides a couple of seconds after the pointer stills
 *     and takes anything appended to it along
 *   - never `insertBefore` the legacy separator or `button:last-child`; those
 *     anchors do not exist in the v3 transport
 *   - guard idempotency against the ACTUAL container, not a hard-coded id: the
 *     rail popover is rebuilt on some navigations
 *   - portal the panel to `<body>`; the trigger lives inside a popover that
 *     closes on an outside click, and a panel parented to it would go too
 *
 * AND WHAT IT REFUSES TO DO: follow its trigger. See DESIGN.md §9 — a panel
 * inside the player's scrolling `<main>` is clipped by that element rather
 * than the screen, a panel pinned by one edge can only grow from the other so
 * changing a control moves the whole thing, and anchored to the rail it sits
 * over the notes. Parking it deletes all of that code.
 */

const SLOT_RETRY_MS = 500;
/** ~12s. A plugin's script can load a long way ahead of the player chrome. */
const SLOT_RETRY_TRIES = 24;

/**
 * @param {object} o
 * @param {string} o.id        the plugin id, for the element ids
 * @param {string} o.label     the button's text
 * @param {string} [o.title]   the button's tooltip
 * @param {string} [o.ariaLabel] the panel's accessible name
 * @param {() => boolean} [o.canOpen] extra gate, e.g. "only in the player"
 */
export function createPanel(o) {
    const id = String(o.id || 'plugin');
    const panelId = `${id}-panel`;
    const buttonId = `${id}-open`;

    const root = document.createElement('div');
    root.className = 'fbk-panel';
    root.id = panelId;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', o.ariaLabel || o.label || id);
    root.hidden = true;

    const head = document.createElement('div');
    head.className = 'fbk-head';
    const title = document.createElement('span');
    title.className = 'fbk-title';
    title.textContent = o.label || id;
    const subtitle = document.createElement('span');
    subtitle.className = 'fbk-subtitle';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'fbk-x';
    close.textContent = '✕';
    close.title = 'Close (Esc)';
    head.appendChild(title);
    head.appendChild(subtitle);
    head.appendChild(close);
    root.appendChild(head);

    const body = document.createElement('div');
    body.className = 'fbk-body';
    root.appendChild(body);

    /*
     * The one imperative surface, and the one exception to "the panel reads
     * only your snapshot": why something just FAILED. That is an event, not a
     * state, so a snapshot cannot hold it. Why something is BLOCKED is not
     * here — that belongs on the disabled control's own tooltip.
     */
    const flash = document.createElement('p');
    flash.className = 'fbk-flash';
    flash.hidden = true;
    body.appendChild(flash);
    let flashTimer = null;

    let open = false;
    let button = null;
    let placed = false;
    let retryTimer = null;
    let tries = 0;
    const listeners = new Set();

    function slot() {
        const fb = window.feedBack;
        const ui = fb && fb.ui;
        if (!ui || typeof ui.playerControlSlot !== 'function') return null;
        try { return ui.playerControlSlot() || null; } catch (_) { return null; }
    }

    function inPlayer() {
        const active = document.querySelector('.screen.active');
        return !!active && active.id === 'player';
    }

    function ensureButton() {
        const container = slot() || document.getElementById('player-controls');
        if (!container) return false;
        if (button && container.contains(button)) return true;
        if (button && button.parentNode) button.parentNode.removeChild(button);

        button = document.createElement('button');
        button.id = buttonId;
        button.type = 'button';
        button.className = 'fbk-open-btn';
        button.title = o.title || o.label || id;
        button.setAttribute('aria-haspopup', 'dialog');
        button.textContent = o.label || id;
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(!open);
        });
        container.appendChild(button);
        return true;
    }

    function ensurePanel() {
        if (placed && root.parentNode === document.body) return;
        document.body.appendChild(root);
        placed = true;
    }

    function announce() {
        for (const fn of Array.from(listeners)) {
            try { fn(open); } catch (err) { console.warn(`[${id}] panel listener threw:`, err); }
        }
    }

    function setOpen(next) {
        // The panel belongs to the player. The button is hidden off it, but a
        // programmatic open can still get here — and did: the highway keeps
        // the last song's data after you navigate away, so a plugin's "ready"
        // stayed true and its panel opened over the song library.
        if (next && !inPlayer()) return;
        if (next && typeof o.canOpen === 'function' && !o.canOpen()) return;
        open = !!next;
        ensurePanel();
        root.hidden = !open;
        root.classList.toggle('fbk-panel-open', open);
        if (button) button.classList.toggle('fbk-on', open);
        announce();
    }

    function syncVisibility() {
        if (!button) return;
        const here = inPlayer();
        button.hidden = !here;
        if (!here && open) setOpen(false);
    }

    function onKeydown(e) {
        if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
        }
    }

    function onDocClick(e) {
        if (!open) return;
        if (root.contains(e.target)) return;
        if (button && button.contains(e.target)) return;
        setOpen(false);
    }

    close.addEventListener('click', () => setOpen(false));

    function attach() {
        ensureButton();
        ensurePanel();
        syncVisibility();
        if (!retryTimer) {
            retryTimer = setInterval(() => {
                tries += 1;
                const ok = ensureButton();
                if (ok) syncVisibility();
                // Keep going past the first success: the slot can be
                // re-created, and ensureButton() is a no-op when in place.
                if (tries > SLOT_RETRY_TRIES && ok) {
                    clearInterval(retryTimer);
                    retryTimer = null;
                }
            }, SLOT_RETRY_MS);
        }
        document.addEventListener('keydown', onKeydown, true);
        document.addEventListener('click', onDocClick, true);
    }

    function detach() {
        if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
        if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('click', onDocClick, true);
        if (button && button.parentNode) button.parentNode.removeChild(button);
        button = null;
        if (root.parentNode) root.parentNode.removeChild(root);
        placed = false;
        listeners.clear();
        open = false;
    }

    return {
        /** Append your controls here. */
        body,
        root,

        attach,
        detach,
        syncVisibility,

        open: () => setOpen(true),
        close: () => setOpen(false),
        toggle: () => setOpen(!open),
        isOpen: () => open,
        onToggle(fn) {
            if (typeof fn === 'function') listeners.add(fn);
            return () => listeners.delete(fn);
        },

        /** The line beside the title — the song, usually. */
        setSubtitle(text) { subtitle.textContent = text || ''; },

        /** Why something just failed. Clears itself; your render never touches it. */
        say(text, ms = 6000) {
            if (!text) return;
            flash.textContent = text;
            flash.hidden = false;
            if (flashTimer) clearTimeout(flashTimer);
            flashTimer = setTimeout(() => {
                flash.hidden = true;
                flash.textContent = '';
                flashTimer = null;
            }, ms);
        },

        /** True when the player screen is showing — the gate the panel uses. */
        inPlayer,
    };
}
