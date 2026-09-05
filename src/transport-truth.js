/*
 * ─────────────────────────────────────────────────────────────────────────
 * CHE COSA DICE L'APP, E PERCHE' NON LO SI CHIEDE PIU' A `#audio`.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Per giorni ho letto `document.getElementById('audio').paused` come "lo stato
 * che l'app dichiara". Su questa installazione quel valore e' spazzatura, e una
 * traccia in console lo ha mostrato mentire in tutte e due le direzioni: diceva
 * PAUSA mentre il motore avanzava, e diceva play per dieci secondi dopo un
 * `song:pause`, a motore fermo.
 *
 * IL MOTIVO. `#audio` non ha uno shim: ne ha due, impilati. Sotto c'e' quello
 * di `juce-audio.js`, che rimanda al motore nativo. Sopra ci si mette il plugin
 * `stems` (`plugins/stems/src/transport.js:334-448`), che ridefinisce
 * `play`, `pause`, `paused`, `currentTime` e `duration` come proprieta' proprie
 * dell'elemento e, quando ha preso in carico il brano (`S.sloppakActive`), le
 * fa rispondere al PROPRIO trasporto WebAudio. Da quel momento
 * `#audio.paused` non e' "l'app dice pausa": e' "la copia di stems non sta
 * suonando", che e' un'altra cosa.
 *
 * Il sensore giusto e' il PULSANTE. `setPlayButtonState` (`transport.js:39`)
 * scrive `aria-pressed` sul pulsante, ed e' chiamato in coppia con
 * `S.isPlaying` in ogni punto che tocca il trasporto — `transport.js:181,190,
 * 314,321`, `count-in.js:248,288`, `juce-audio.js:908,924,1004`,
 * `app.js:879,892,913,991,1818`, `session.js:238`. Nessuno lo scrive senza
 * scrivere anche l'altro. Quindi l'attributo e' uno specchio fedele di
 * `S.isPlaying`, che e' proprio la cosa che non possiamo leggere.
 *
 * `#audio.paused` resta come ripiego per gli ospiti senza quel pulsante (il
 * browser, le prove), dove nessuno impila niente e l'elemento dice la verita'.
 */

/** L'elemento del trasporto, o `null` prima che il player esista. */
export function audioEl() {
    return document.getElementById('audio');
}

/** Il trasporto dell'app e' fermo? Letto dal pulsante, non dall'elemento. */
export function appSaysPaused() {
    const btn = document.getElementById('btn-play');
    if (btn && btn.hasAttribute('aria-pressed')) {
        return btn.getAttribute('aria-pressed') !== 'true';
    }
    const el = audioEl();
    return !el || el.paused === true;
}

/**
 * Sta suonando qualcosa che l'app non sa di star suonando?
 *
 * E' la firma della copia di stems rimasta accesa: l'elemento dice "sto
 * suonando" e il pulsante dice pausa. Con il solo shim JUCE i due non possono
 * discordare — li' `paused` E' `!S.isPlaying`, cioe' la stessa cosa che scrive
 * il pulsante — quindi questa condizione non puo' scattare a vuoto.
 */
export function foreignSound() {
    const el = audioEl();
    return !!el && el.paused === false && appSaysPaused();
}
