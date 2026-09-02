/*
 * The store is where a wrong decision is expensive, because it is the only
 * thing here that outlives a session.
 *
 * Three of its rules get tests: a best only ever climbs (the number on a chip
 * answers "how well have you EVER played this"), a re-converted pack gets a
 * fresh history rather than inheriting numbers earned against different notes,
 * and an unreadable or future-version store degrades to defaults instead of
 * being half-read.
 *
 * localStorage is stubbed BEFORE the module is imported, hence the dynamic
 * import: ESM hoists static imports above any setup code.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

function installStorage() {
    const map = new Map();
    globalThis.localStorage = {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        clear: () => map.clear(),
        _map: map,
    };
    return map;
}

const map = installStorage();
const store = await import('../src/store.js');

function reset() {
    map.clear();
}

// ── identity ─────────────────────────────────────────────────────────────

test('a song is identified by its file and its arrangement', () => {
    // The two together decide which notes are on the highway, so Lead and
    // Bass on the same pack are different practice histories.
    assert.equal(
        store.songKey({ filename: 'Metallica - Blackened [d26d2b08].feedpak', arrangement: 'Lead' }),
        'Metallica - Blackened [d26d2b08].feedpak::Lead',
    );
    assert.notEqual(
        store.songKey({ filename: 'a.feedpak', arrangement: 'Lead' }),
        store.songKey({ filename: 'a.feedpak', arrangement: 'Bass' }),
    );
});

test('a re-converted pack gets a fresh history', () => {
    // The filename carries the content hash. Inheriting a best earned against
    // different notes would be the dishonest option even though it keeps more.
    assert.notEqual(
        store.songKey({ filename: 'Song [aaaa1111].feedpak', arrangement: 'Lead' }),
        store.songKey({ filename: 'Song [bbbb2222].feedpak', arrangement: 'Lead' }),
    );
});

test('a song with no filename has no key, and writes are refused', () => {
    reset();
    assert.equal(store.songKey({}), null);
    assert.equal(store.songKey(null), null);
    assert.equal(store.patchSong(null, { speedPct: 80 }), null);
    assert.equal(store.recordRange(null, 'r', { best: 1 }), null);
});

// ── settings ─────────────────────────────────────────────────────────────

test('settings round-trip, and absent keys fall back to the defaults', () => {
    reset();
    const d = store.defaults();
    assert.deepEqual(store.getSettings(), d);
    store.setSettings({ goalPct: 70 });
    assert.equal(store.getSettings().goalPct, 70);
    assert.equal(store.getSettings().barCount, d.barCount);
});

test('remembering difficulty is off by default', () => {
    // It writes a GLOBAL host setting, so it cannot be a default.
    assert.equal(store.defaults().rememberDifficulty, false);
    assert.equal(store.defaults().rememberSpeed, true);
});

test('a corrupt store degrades to defaults', () => {
    reset();
    map.set(store.KEY, '{not json');
    assert.deepEqual(store.getSettings(), store.defaults());
});

test('a store from a future version is treated as absent, not half-read', () => {
    reset();
    map.set(store.KEY, JSON.stringify({ v: 99, settings: { goalPct: 1 }, songs: { x: {} } }));
    assert.equal(store.getSettings().goalPct, store.defaults().goalPct);
    assert.equal(store.getSong('x'), null);
});

test('resetting settings does not touch what has been measured', () => {
    reset();
    store.recordRange('song::Lead', 'r1', { label: 'Verse 1', best: 0.5 });
    store.resetSettings();
    assert.ok(store.getSong('song::Lead').ranges.r1);
});

// ── per-song ─────────────────────────────────────────────────────────────

test('a best only ever climbs', () => {
    reset();
    store.recordRange('s::Lead', 'r1', { label: 'Verse 1', best: 0.6 });
    store.recordRange('s::Lead', 'r1', { label: 'Verse 1', best: 0.4 });
    assert.equal(store.getSong('s::Lead').ranges.r1.best, 0.6);
    store.recordRange('s::Lead', 'r1', { label: 'Verse 1', best: 0.81 });
    assert.equal(store.getSong('s::Lead').ranges.r1.best, 0.81);
});

test('a drill best is kept apart from a normal-play best', () => {
    reset();
    store.recordRange('s::Lead', 'r1', { best: 0.9 });
    store.recordRange('s::Lead', 'r1', { drillBest: 0.55 });
    const rec = store.getSong('s::Lead').ranges.r1;
    assert.equal(rec.best, 0.9);
    assert.equal(rec.drillBest, 0.55);
});

test('a passage with only a drill result has no normal-play best', () => {
    // Not 0: `Number(null)` is 0 and 0 is finite, so an absent measurement is
    // one careless check away from reading as "missed everything".
    reset();
    store.recordRange('s::Lead', 'r1', { drillBest: 0.7, graduated: true });
    assert.equal(store.getSong('s::Lead').ranges.r1.best, null);
    assert.equal(store.getSong('s::Lead').ranges.r1.drillBest, 0.7);
});

test('plays counts every attempt', () => {
    reset();
    for (let i = 0; i < 4; i++) store.recordRange('s::Lead', 'r1', { best: 0.5 });
    assert.equal(store.getSong('s::Lead').ranges.r1.plays, 4);
});

test('a result can decline to count as an attempt', () => {
    reset();
    store.recordRange('s::Lead', 'r1', { best: 0.5 });
    store.recordRange('s::Lead', 'r1', { best: 0.5, countsAsPlay: false });
    assert.equal(store.getSong('s::Lead').ranges.r1.plays, 1);
});

test('graduated is sticky', () => {
    reset();
    store.recordRange('s::Lead', 'r1', { graduated: true });
    store.recordRange('s::Lead', 'r1', { graduated: false });
    assert.equal(store.getSong('s::Lead').ranges.r1.graduated, true);
});

test('speed and difficulty are remembered per song', () => {
    reset();
    store.patchSong('s::Lead', { speedPct: 80 });
    store.patchSong('s::Lead', { difficultyPct: 60 });
    const saved = store.getSong('s::Lead');
    assert.equal(saved.speedPct, 80);
    assert.equal(saved.difficultyPct, 60);
});

test('patching a song never drops what has been measured', () => {
    reset();
    store.recordRange('s::Lead', 'r1', { best: 0.5 });
    store.patchSong('s::Lead', { speedPct: 90 });
    assert.ok(store.getSong('s::Lead').ranges.r1);
});

test('forgetting one song leaves the others', () => {
    reset();
    store.recordRange('a::Lead', 'r', { best: 1 });
    store.recordRange('b::Lead', 'r', { best: 1 });
    store.forgetSong('a::Lead');
    assert.equal(store.getSong('a::Lead'), null);
    assert.ok(store.getSong('b::Lead'));
});

test('forgetting everything keeps the preferences', () => {
    // "Forget my scores" is not "reset my preferences".
    reset();
    store.setSettings({ goalPct: 70 });
    store.recordRange('a::Lead', 'r', { best: 1 });
    store.forgetEverything();
    assert.equal(store.getSong('a::Lead'), null);
    assert.equal(store.getSettings().goalPct, 70);
});

test('usage reports what is stored', () => {
    reset();
    store.recordRange('a::Lead', 'r1', { best: 1 });
    store.recordRange('a::Lead', 'r2', { best: 1 });
    const u = store.usage();
    assert.equal(u.songs, 1);
    assert.equal(u.ranges, 2);
    assert.ok(u.bytes > 0);
});

test('the store evicts the least recently touched song when it fills', () => {
    reset();
    for (let i = 0; i < 205; i++) store.recordRange('song' + i + '::Lead', 'r', { best: 1 });
    assert.equal(store.usage().songs, 200);
    assert.equal(store.getSong('song0::Lead'), null);
    assert.ok(store.getSong('song204::Lead'));
});

// ── the escape hatch ─────────────────────────────────────────────────────

test('disabled is read from its own key, so it survives an unreadable store', () => {
    reset();
    store.setDisabled(true);
    map.set(store.KEY, 'garbage');
    assert.equal(store.isDisabled(), true);
    store.setDisabled(false);
    assert.equal(store.isDisabled(), false);
});

test('a storage that throws does not take the plugin down', () => {
    const good = globalThis.localStorage;
    globalThis.localStorage = {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
        removeItem() { throw new Error('denied'); },
    };
    try {
        assert.deepEqual(store.getSettings(), store.defaults());
        assert.equal(store.isDisabled(), false);
        assert.doesNotThrow(() => store.setSettings({ goalPct: 50 }));
        assert.doesNotThrow(() => store.recordRange('s::Lead', 'r', { best: 1 }));
    } finally {
        globalThis.localStorage = good;
    }
});
