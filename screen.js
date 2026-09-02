/*
 * Riff Repeater — the practice loop, in one control.
 *
 * One line, because the host loads a single script per plugin and this one is
 * worth splitting. `scriptType: "module"` in the manifest is what makes the
 * import resolve.
 *
 * THE SHAPE OF THIS REPOSITORY IS DELIBERATE. The plan is for this to end up
 * in core, so the code is already split the way core is split:
 *
 *   src/       pure logic and one host seam — the part that MOVES to
 *              static/js/ in the eventual PR, unchanged.
 *   src/ui/    the button, the panel and the portal — the part that gets
 *              THROWN AWAY, because in core the same controls belong in a
 *              third row of the Section Practice popover, not in a floating
 *              panel launched from the plugins rail.
 *
 * src/ui/ lives under src/ because that is the only source tree the host
 * serves: `/api/plugins/<id>/src/<path>` and `/api/plugins/<id>/assets/<path>`
 * are the two routes there are, and a top-level `ui/` simply 404s. The split
 * is by directory, not by route.
 *
 * No file in src/ outside src/ui/ touches a DOM node of its own, and none of
 * them import anything from src/ui/. That is the whole trick: the merge is a
 * move plus a new mount, not a rewrite.
 *
 * See README.md § "Merging this into core".
 */
import './src/main.js';
