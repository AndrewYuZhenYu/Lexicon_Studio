// Companion for dictionary_workspace.html. The original v10.5 page remains available.
(() => {
    'use strict';
    const CHANNEL = 'dictionary-workspace-v1';
    function centerWorkspaceSearch() {
        const panel = document.querySelector?.('.search-surface');
        const input = document.getElementById('wordInput');
        const target = panel && panel.getBoundingClientRect().height <= window.innerHeight * .9 ? panel : input;
        target?.scrollIntoView?.({
            block: 'center',
            behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
        });
    }
    window.centerWorkspaceSearch = centerWorkspaceSearch;
    const reply = (type, data = {}) => {
        if (window.parent !== window) window.parent.postMessage({ channel: CHANNEL, type, ...data }, '*');
    };
    const originalToggleFavorite = window.toggleFavoriteWord || toggleFavoriteWord;
    if (typeof originalToggleFavorite === 'function') {
        window.toggleFavoriteWord = function (word) {
            const result = originalToggleFavorite(word);
            reply('favorite-state', { word, saved: hasFavorite(word) });
            return result;
        };
    }

    window.addEventListener('message', event => {
        if (event.source !== window.parent || event.data?.channel !== CHANNEL) return;
        const message = event.data;
        try {
            if (message.type === 'query') {
                const word = String(message.word || '').trim();
                if (!word || word.length > 200) throw new Error('词条为空或过长');
                document.getElementById('wordInput').value = word;
                manualSearch();
                centerWorkspaceSearch();
                reply('query-accepted', { word });
            } else if (message.type === 'focus-search') {
                centerWorkspaceSearch();
            } else if (message.type === 'get-favorites') {
                const words = Array.isArray(message.words) ? message.words.slice(0, 5000) : [];
                reply('favorites', { entries: words.filter(word => typeof word === 'string')
                    .map(word => [word, hasFavorite(word)]) });
            } else if (message.type === 'set-favorite') {
                const word = String(message.word || '').trim();
                if (!word || word.length > 200) throw new Error('词条为空或过长');
                const desired = !!message.desired;
                if (hasFavorite(word) !== desired) window.toggleFavoriteWord(word);
                else reply('favorite-state', { word, saved: desired });
            }
        } catch (error) { reply('error', { text: error.message || '右侧操作失败' }); }
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => reply('ready'), { once: true });
    else reply('ready');
})();
