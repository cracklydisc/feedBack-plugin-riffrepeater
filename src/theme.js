/*
 * The host's palette, as custom properties this plugin's stylesheet can use.
 *
 * A stylesheet cannot call an API, and this panel has to sit on the player
 * chrome without looking bolted on: same card colour, same border, same
 * accent. Hardcoding rgb(30,41,59) would be right today and wrong the moment
 * somebody equips a shop theme — which is the exact mistake docs/
 * host-theme-contract.md was written about.
 *
 * `feedBack.theme.get()` is the sanctioned read surface. The `--fbv-*`
 * variables are documented as internal plumbing and are not ours to read.
 *
 * The fallbacks below are the host's own default palette, so an older host
 * with no theme API gets the look it would have had anyway.
 */

import { host } from './host.js';

/** role -> the default "r g b" triplet, mirroring the host's `fb` palette. */
const ROLES = {
    bg: '15 23 42',
    card: '30 41 59',
    cardMuted: '11 18 32',
    border: '51 65 85',
    text: '248 250 252',
    textDim: '148 163 184',
    primary: '14 165 233',
    primaryHi: '56 189 248',
    accent: '239 68 68',
    good: '34 197 94',
    mid: '234 179 8',
    low: '239 68 68',
    'on-accent': '248 250 252',
    'focus-ring': '56 189 248',
};

/** The custom-property name for a role: `cardMuted` -> `--rr-card-muted`. */
function propName(role) {
    return '--rr-' + role.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

let unsubscribe = null;

function apply(tokens) {
    const root = document.documentElement;
    for (const role of Object.keys(ROLES)) {
        const value = (tokens && tokens[role]) || ROLES[role];
        root.style.setProperty(propName(role), value);
    }
    root.style.setProperty('--rr-motion', host.prefersReducedMotion() ? 'none' : 'var(--rr-motion-on)');
}

/** Write the tokens now, and again whenever the equipped theme changes. */
export function follow() {
    apply(host.themeTokens());
    if (unsubscribe) return;
    unsubscribe = host.on('theme:changed', () => apply(host.themeTokens()));
}

export function unfollow() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    const root = document.documentElement;
    for (const role of Object.keys(ROLES)) root.style.removeProperty(propName(role));
    root.style.removeProperty('--rr-motion');
}
