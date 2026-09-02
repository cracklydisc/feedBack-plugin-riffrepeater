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
 *   - Portal the panel to the body. The trigger lives inside a rail popover
 *     that closes on an outside click; a panel parented to it would go with it.
 *
 * THE PANEL DOES NOT FOLLOW ITS TRIGGER. It is parked at a fixed corner —
 * top-right, 64px/12px — because that is where the 3D Highway parks its
 * settings pane and where Live Tab moved its panel to for exactly the reasons
 * we hit here. Live Tab's own commit puts it best: a panel anchored to a pill
 * inside the player's scrolling <main> gets clipped by that element rather
 * than the screen, and a panel pinned by one edge can only grow from the
 * other, so changing a control moves the whole thing. Parking it kills the
 * placement code, the flipping, and the re-anchoring on scroll and resize —
 * and makes the three plugins read as one app.
 *
 * See assets/riffrepeater.css for the corner itself; nothing here sets a
 * position.
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

    function show() {
        ensurePanel();
        panel.hidden = false;
        panel.classList.add('rr-panel-open');
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

    function attach() {
        ensureButton();
        ensurePanel();
        syncVisibility();
        startRetry();
        document.addEventListener('keydown', onKeydown, true);
        document.addEventListener('click', onDocClick, true);
    }

    function detach() {
        if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('click', onDocClick, true);
        if (button && button.parentNode) button.parentNode.removeChild(button);
        button = null;
        if (panel.parentNode) panel.parentNode.removeChild(panel);
        placed = false;
    }

    return { attach, detach, show, hide, syncVisibility };
}
