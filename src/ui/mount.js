/*
 * Getting the panel onto the screen, and off it again.
 *
 * THIS FILE IS THE OTHER THROWAWAY HALF — it exists to satisfy the one
 * documented rule for putting a control in the v3 player, and every line of it
 * disappears if these controls land in the Section Practice popover in core.
 *
 * The rules it is obeying (docs/plugin-v3-ui.md):
 *
 *   - Append to `feedBack.ui.playerControlSlot()`, never to `#player-controls`.
 *     The transport auto-hides a couple of seconds after the pointer stills,
 *     taking anything appended to it along.
 *   - Never `insertBefore` the legacy separator or `button:last-child`. Those
 *     anchors do not exist in the v3 transport.
 *   - Guard idempotency against the ACTUAL container, not a hard-coded id.
 *   - Position a panel from the trigger's own rect and portal it to the body.
 *     The trigger lives inside a rail popover that closes on an outside click;
 *     a panel parented to it would go with it.
 */

import { host } from '../host.js';

const BUTTON_ID = 'rr-open';
const PANEL_ID = 'rr-panel-root';

/** How long to keep looking for the slot before giving up quietly. */
const SLOT_RETRY_MS = 500;
const SLOT_RETRY_TRIES = 24;   // ~12s — plugin load can precede the chrome by a lot

export function createMount({ panel, onOpen, onClose, isOpen }) {
    let button = null;
    let retryTimer = null;
    let tries = 0;
    let placed = false;

    function slot() {
        return host.controlSlot();
    }

    function ensureButton() {
        const container = slot() || document.getElementById('player-controls');
        if (!container) return false;

        // Idempotent against the real container: the rail popover is rebuilt
        // on some navigations, and a stale node held in a closure would leave
        // the button "present" while nothing is on screen.
        if (button && container.contains(button)) return true;

        if (button && button.parentNode) button.parentNode.removeChild(button);

        button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.className = 'rr-open-btn';
        button.title = 'Riff Repeater — drill a passage';
        button.setAttribute('aria-haspopup', 'dialog');
        button.textContent = '⏱ Riff Repeater';
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isOpen()) onClose(); else onOpen();
        });
        container.appendChild(button);
        return true;
    }

    function ensurePanel() {
        if (placed && panel.parentNode === document.body) return;
        panel.id = PANEL_ID;
        document.body.appendChild(panel);
        placed = true;
    }

    /**
     * A rect worth anchoring to, or null.
     *
     * The trigger lives inside the rail's popover, which is `display:none`
     * while closed — so a programmatic open (or an open after the popover has
     * closed) reads a rect of all zeros. Anchoring to that puts the panel over
     * the song title in the top-left corner, which is how this was found.
     */
    function usableRect(node) {
        if (!node) return null;
        const r = node.getBoundingClientRect();
        if (!r || (r.width === 0 && r.height === 0)) return null;
        return r;
    }

    /**
     * Put the panel beside its trigger, then pull it back inside the viewport.
     *
     * Anchoring to the trigger rather than to a fixed corner matters because
     * the rail is on the left and the detector's own drill HUD is pinned top
     * centre: a panel in the corner would sooner or later sit under it. When
     * there is no trigger rect, the rail itself is the next best anchor — it
     * is the thing the panel has to clear.
     */
    function place() {
        ensurePanel();
        const margin = 12;
        // Measure before positioning — the panel has to be visible for its own
        // rect to be real, and it is made visible by the caller before this runs.
        const pw = panel.offsetWidth || 360;
        const ph = panel.offsetHeight || 420;

        const rect = usableRect(button)
            || usableRect(document.getElementById('v3-player-rail'))
            || usableRect(document.getElementById('v3-railzone'));

        let left = rect ? rect.right + margin : margin;
        let top = rect ? rect.top : margin;

        // With no anchor at all, centre vertically rather than sitting in the
        // corner the app puts the song title in.
        if (!rect) top = Math.max(margin, (window.innerHeight - ph) / 2);

        if (left + pw + margin > window.innerWidth) {
            left = rect
                ? Math.max(margin, rect.left - pw - margin)
                : Math.max(margin, window.innerWidth - pw - margin);
        }
        top = Math.min(top, Math.max(margin, window.innerHeight - ph - margin));
        top = Math.max(margin, top);

        panel.style.left = Math.round(left) + 'px';
        panel.style.top = Math.round(top) + 'px';
    }

    function show() {
        ensurePanel();
        panel.hidden = false;
        panel.classList.add('rr-panel-open');
        // Place SYNCHRONOUSLY. Reading offsetWidth in place() forces the
        // layout it needs, so there is nothing to wait for — and waiting was a
        // bug: in an embedded webview requestAnimationFrame can be throttled
        // hard, which left the panel sitting at 0,0 over the song title for as
        // long as the frame took to arrive.
        place();
        // Then again on the next frame if one comes, for the case where a font
        // or an image lands after first layout and changes the height.
        requestAnimationFrame(place);
        if (button) button.classList.add('rr-open-btn-on');
    }

    function hide() {
        panel.classList.remove('rr-panel-open');
        panel.hidden = true;
        if (button) button.classList.remove('rr-open-btn-on');
    }

    /** The button belongs in the player and nowhere else. */
    function syncVisibility() {
        if (!button) return;
        const inPlayer = host.inPlayer();
        button.hidden = !inPlayer;
        if (!inPlayer && isOpen()) onClose();
    }

    function startRetry() {
        if (retryTimer) return;
        retryTimer = setInterval(() => {
            tries += 1;
            const ok = ensureButton();
            if (ok) syncVisibility();
            // Keep going even after a success: the slot can be re-created, and
            // ensureButton() is a no-op when the button is already in place.
            if (tries > SLOT_RETRY_TRIES && ok) {
                clearInterval(retryTimer);
                retryTimer = null;
            }
        }, SLOT_RETRY_MS);
    }

    function onKeydown(e) {
        if (e.key === 'Escape' && isOpen()) {
            e.stopPropagation();
            onClose();
        }
    }

    function onDocClick(e) {
        if (!isOpen()) return;
        if (panel.contains(e.target)) return;
        if (button && button.contains(e.target)) return;
        onClose();
    }

    function onResize() {
        if (isOpen()) place();
    }

    function attach() {
        ensureButton();
        ensurePanel();
        syncVisibility();
        startRetry();
        document.addEventListener('keydown', onKeydown, true);
        document.addEventListener('click', onDocClick, true);
        window.addEventListener('resize', onResize);
    }

    function detach() {
        if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('click', onDocClick, true);
        window.removeEventListener('resize', onResize);
        if (button && button.parentNode) button.parentNode.removeChild(button);
        button = null;
        if (panel.parentNode) panel.parentNode.removeChild(panel);
        placed = false;
    }

    return { attach, detach, show, hide, syncVisibility, place };
}
