/* Two independent native Rive scenes, one shared runtime and motion preference. */
(() => {
    'use strict';
    const panels = [...document.querySelectorAll('[data-rive-panel]')].map(canvas => ({
        canvas, player: null, loaded: false, loading: false, failed: false, hasFrame: false,
    }));
    if (!panels.length) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = matchMedia('(min-width: 761px)');
    const toggle = document.getElementById('motion-toggle');
    let preference = null;
    try { preference = localStorage.getItem('apocrypha-motion'); } catch (_) { /* Optional storage. */ }
    let enabled = preference === null ? !motion.matches : preference === 'on';
    let disposed = false;
    let runtimePromise;

    function syncReady() {
        document.documentElement.classList.toggle('rive-ready', panels.every(p => p.loaded && p.hasFrame));
    }
    function poster(panel) {
        panel.hasFrame = false;
        panel.canvas.parentElement.classList.remove('panel-ready');
        syncReady();
    }
    function updateControl() {
        const loading = panels.some(p => p.loading);
        const missing = panels.some(p => !p.loaded);
        document.documentElement.classList.toggle('motion-enabled', enabled);
        toggle.hidden = false;
        toggle.disabled = loading;
        toggle.setAttribute('aria-pressed', String(enabled && panels.some(p => p.loaded)));
        toggle.textContent = loading ? 'Carregando animações…' : missing ? 'Tentar carregar animação' : enabled ? 'Pausar animações' : 'Ativar animações';
    }
    function playback() {
        updateControl();
        if (disposed) return;
        for (const panel of panels) {
            if (!panel.loaded) continue;
            if (!enabled || !desktop.matches || document.hidden) {
                panel.player.pause();
                poster(panel);
            } else {
                panel.player.resizeDrawingSurfaceToCanvas();
                panel.player.play('Living Apocrypha');
            }
        }
    }
    function loadRuntime() {
        if (window.rive) return Promise.resolve();
        if (!runtimePromise) runtimePromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@rive-app/webgl2@2.49.4/rive.js';
            script.onload = resolve;
            script.onerror = () => {
                runtimePromise = null;
                script.remove();
                reject(new Error('Rive runtime could not be loaded'));
            };
            document.head.append(script);
        });
        return runtimePromise;
    }
    function fail(panel, error) {
        panel.loading = false;
        panel.loaded = false;
        panel.failed = true;
        poster(panel);
        updateControl();
        console.warn(`Apocrypha ${panel.canvas.id}: using the static artwork.`, error);
    }
    async function startPanel(panel) {
        if (disposed || panel.loading || panel.loaded) return;
        panel.loading = true;
        panel.failed = false;
        updateControl();
        try {
            if (panel.player) { panel.player.cleanup(); panel.player = null; }
            const response = await fetch(panel.canvas.dataset.riveSrc);
            if (!response.ok) throw new Error(`Rive asset: HTTP ${response.status}`);
            const buffer = await response.arrayBuffer();
            await loadRuntime();
            if (disposed) return;
            panel.player = new window.rive.Rive({
                buffer, canvas: panel.canvas,
                artboard: panel.canvas.dataset.artboard,
                stateMachine: 'Living Apocrypha',
                autoplay: enabled && !document.hidden && desktop.matches,
                layout: new window.rive.Layout({ fit: window.rive.Fit.Cover,
                    alignment: panel.canvas.dataset.alignment === 'left' ? window.rive.Alignment.CenterLeft : window.rive.Alignment.CenterRight }),
                onLoad() {
                    if (disposed) return;
                    panel.loaded = true;
                    panel.loading = false;
                    panel.player.resizeDrawingSurfaceToCanvas();
                    window.dispatchEvent(new CustomEvent('apocrypha:panel-ready', { detail: { id: panel.canvas.id, player: panel.player } }));
                    if (panel.canvas.id === 'margem-esq') window.dispatchEvent(new CustomEvent('apocrypha:ready', { detail: panel.player }));
                    playback();
                },
                onAdvance() {
                    if (disposed) return;
                    if (!enabled || !desktop.matches || document.hidden) {
                        poster(panel);
                        if (panel.loaded) panel.player.pause();
                    } else if (!panel.hasFrame) {
                        panel.hasFrame = true;
                        panel.canvas.parentElement.classList.add('panel-ready');
                        syncReady();
                    }
                },
                onLoadError: error => fail(panel, error),
            });
        } catch (error) { fail(panel, error.message); }
    }
    const observer = new ResizeObserver(() => {
        for (const panel of panels) if (panel.loaded && !disposed && desktop.matches) panel.player.resizeDrawingSurfaceToCanvas();
    });
    panels.forEach(p => observer.observe(p.canvas));
    function systemMotion() {
        if (preference === null) enabled = !motion.matches;
        playback();
    }
    toggle.addEventListener('click', () => {
        const missing = panels.some(p => !p.loaded);
        enabled = missing || !enabled;
        preference = enabled ? 'on' : 'off';
        try { localStorage.setItem('apocrypha-motion', preference); } catch (_) { /* Keep choice for this page. */ }
        panels.filter(p => !p.loaded).forEach(startPanel);
        playback();
    });
    document.addEventListener('visibilitychange', playback);
    motion.addEventListener('change', systemMotion);
    desktop.addEventListener('change', playback);
    window.addEventListener('pagehide', event => {
        if (event.persisted) { panels.forEach(p => { if (p.loaded) p.player.pause(); }); return; }
        disposed = true;
        observer.disconnect();
        document.removeEventListener('visibilitychange', playback);
        motion.removeEventListener('change', systemMotion);
        desktop.removeEventListener('change', playback);
        panels.forEach(p => { if (p.player) p.player.cleanup(); });
    });
    window.addEventListener('pageshow', playback);
    panels.forEach(startPanel);
})();
