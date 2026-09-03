// ── Banco di prova del drill, senza microfono ────────────────────────────
//
// Incollalo nella console del player, con una canzone caricata e il pannello
// aperto. Suona un passaggio "perfetto" a comando e guarda il direttore salire
// di gradino, senza strumento e senza microfono.
//
// COME FUNZIONA, e perche e lecito: il punteggio di un giro lo calcola
// `_drillConductorOnWrap` da `noteResults` (i verdetti) diviso i note e chord
// che il CHART chiede nella finestra giudicata. Entrambi sono raggiungibili
// dall'esterno — `noteDetect._recordJudgment` scrive in noteResults e
// `feedBack.emit('loop:restart')` e lo stesso evento che il count-in manda a
// ogni giro. Quindi non si simula il rilevamento: si iniettano i verdetti che
// il rilevamento produrrebbe, e tutto il resto e il codice vero.
//
// PERCHE ESISTE: il ciclo che questo plugin serve — 100% su un passaggio corto,
// la velocita che sale, il diploma — non era mai stato provato per intero,
// perche l'ambiente di verifica non ha microfono. Verificato cosi il 3/9/2026
// su Prechorus 2 (12,1s, 12 note): 80 -> 85 -> 90 -> 95 -> 100, diploma al
// settimo giro.
//
// DUE AVVERTENZE:
//  - i verdetti iniettati con `emit: false` NON arrivano al nostro contatore
//    live, che ascolta gli eventi `notedetect:hit` / `notedetect:miss`. Per
//    provare anche quello, manda l'evento accanto al verdetto (vedi in fondo).
//  - serve `getSongInfo().duration`: se il brano non e caricato del tutto,
//    `startDrill` rifiuta con "no song duration available".

(async () => {
    const nd = window.noteDetect;
    const hw = window.highway;
    const rr = window.riffRepeater;
    const log = [];
    const say = (o) => { log.push(o); return o; };

    const notesIn = (a, b) => {
        const out = [];
        const t = (x) => Number.isFinite(x && x.t) ? x.t : (Number.isFinite(x && x.time) ? x.time : null);
        for (const n of (hw.getNotes ? hw.getNotes() : [])) {
            const x = t(n); if (x !== null && x >= a && x <= b) out.push({ t: x, chord: false });
        }
        for (const c of (hw.getChords ? hw.getChords() : [])) {
            const x = t(c); if (x !== null && x >= a && x <= b) out.push({ t: x, chord: true });
        }
        return out.sort((p, q) => p.t - q.t);
    };

    /** Suona il passaggio: un verdetto per ogni nota che il chart chiede. */
    const playPass = (a, b, { missEvery = 0 } = {}) => {
        const items = notesIn(a, b);
        let i = 0, hits = 0, misses = 0;
        for (const it of items) {
            i += 1;
            const hit = !(missEvery > 0 && i % missEvery === 0);
            const key = it.chord ? `${it.t.toFixed(3)}_chord` : `${it.t.toFixed(6)}`;
            nd._recordJudgment(key, {
                hit, noteTime: it.t, chord: it.chord,
                detail: hit ? 'bench' : 'missed', how: hit ? null : 'missed',
                s: 0, f: 0,
            }, { count: false, emit: false });
            hit ? hits++ : misses++;
        }
        return { charted: items.length, hits, misses };
    };

    const wrap = () => {
        // Lo stesso evento che emette il count-in a ogni giro del loop.
        window.feedBack.emit('loop:restart', {});
    };

    const state = () => {
        const s = nd.getConductorState ? nd.getConductorState() : {};
        return {
            active: !!s.active,
            rung: s.rung,
            ladder: Array.isArray(s.ladder) ? s.ladder.map((v) => Math.round(v * 100)) : s.ladder,
            atPct: Array.isArray(s.ladder) && Number.isFinite(s.rung)
                ? Math.round((s.ladder[s.rung] || 1) * 100) : null,
            best: Number.isFinite(s.best) ? Math.round(s.best * 100) : s.best,
            goal: Number.isFinite(s.goal) ? Math.round(s.goal * 100) : s.goal,
            rate: (() => { const el = document.getElementById('audio'); return el ? +el.playbackRate.toFixed(3) : null; })(),
        };
    };

    // ── il passaggio: il piu corto che il brano offre con qualche nota ────
    const secs = rr.ranges().sections || [];
    const shortest = secs
        .map((s) => ({ ...s, span: s.end - s.start }))
        .filter((s) => Number.isFinite(s.events) ? s.events > 0 : true)
        .sort((a, b) => a.span - b.span)
        .find((s) => notesIn(s.start, s.end).length >= 2);
    if (!shortest) return say({ fatal: 'nessuna sezione con almeno due note' });
    rr.select(shortest.key);
    await new Promise((r) => setTimeout(r, 400));

    const sel = rr.selection();
    say({ step: 'passaggio', label: sel.label, span: +(sel.end - sel.start).toFixed(2),
          charted: notesIn(sel.start, sel.end).length, eventsFromModel: sel.events });

    // ── avvio: la scala che imposteremmo noi ─────────────────────────────
    const ladder = [0.8, 0.85, 0.9, 0.95, 1];
    const ok = await nd.startDrill(sel.start, sel.end, { goal: 1, speedLadder: ladder, label: sel.label });
    await new Promise((r) => setTimeout(r, 900));
    say({ step: 'startDrill', accepted: ok !== false, ...state() });

    const range = (nd.getConductorState() || {}).range || {};
    const ja = Number.isFinite(range.judgeStart) ? range.judgeStart : sel.start;
    const jb = Number.isFinite(range.judgeEnd) ? range.judgeEnd : sel.end;
    say({ step: 'finestra giudicata', judgeStart: +ja.toFixed(2), judgeEnd: +jb.toFixed(2),
          loopStart: Number.isFinite(range.loopStart) ? +range.loopStart.toFixed(2) : null,
          runUp: Number.isFinite(range.loopStart) ? +(ja - range.loopStart).toFixed(2) : null,
          chartedInWindow: notesIn(ja, jb).length });

    // ── giri perfetti finche non si diploma (o finche non si arrende) ────
    for (let pass = 1; pass <= 14; pass++) {
        const played = playPass(ja, jb);
        wrap();
        await new Promise((r) => setTimeout(r, 700));
        const st = state();
        const panel = (() => {
            const p = document.querySelector('.fbk-panel');
            if (!p) return null;
            const v = p.querySelector('.fbk-live-value');
            const on = p.querySelector('.fbk-rail-mark[data-state="on"]');
            return { gauge: v && v.textContent, railOn: on && on.textContent, folded: p.dataset.folded };
        })();
        say({ step: `giro ${pass}`, ...played, ...st, panel });
        if (!st.active) { say({ step: 'fine', why: 'il direttore ha chiuso il drill' }); break; }
    }

    return { log, drilling: nd.isDrilling() };
})()
