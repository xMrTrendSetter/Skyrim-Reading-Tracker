/* Update reading and navigation without destroying the Rive player. */
(() => {
    'use strict';
    let navigation;
    function restoreShelf() {
        const shelf = document.querySelector('.black-books');
        try { if (shelf) shelf.open = sessionStorage.getItem('apocrypha-shelf') === 'open'; } catch (_) { /* Native details still works without storage. */ }
    }
    document.addEventListener('toggle', event => {
        if (!event.target.matches('.black-books')) return;
        try { sessionStorage.setItem('apocrypha-shelf', event.target.open ? 'open' : 'closed'); } catch (_) { /* Optional preference. */ }
    }, true);
    restoreShelf();
    function feedback(message) {
        const node = document.getElementById('reading-feedback');
        node.textContent = message;
        node.hidden = !message;
    }
    async function navigate(url, push = true) {
        if (navigation) navigation.abort();
        navigation = new AbortController();
        try {
            const response = await fetch(url, { signal: navigation.signal });
            if (!response.ok) throw new Error('Navigation failed');
            const documentNext = new DOMParser().parseFromString(await response.text(), 'text/html');
            const next = documentNext.querySelector('main.container');
            if (!next) throw new Error('Invalid response');
            document.querySelector('main.container').replaceWith(next);
            restoreShelf();
            if (push) history.pushState(null, '', url);
        } catch (error) {
            if (error.name !== 'AbortError') feedback('Não foi possível carregar os livros. Tente novamente.');
        }
    }
    document.addEventListener('submit', async event => {
        const form = event.target;
        if (form.matches('.search-bar')) {
            event.preventDefault();
            navigate('/?' + new URLSearchParams(new FormData(form)));
            return;
        }
        const button = form.querySelector('.check');
        if (!button) return;
        event.preventDefault();
        if (button.disabled) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        feedback('');
        try {
            const response = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error('Reading update failed');
            const book = await response.json();
            document.querySelector('[data-read-count]').textContent = book.read_count;
            document.querySelector('[data-total-count]').textContent = book.total;
            const row = button.closest('li');
            row.classList.toggle('read', book.is_read);
            button.setAttribute('aria-pressed', String(book.is_read));
            const label = book.is_read ? 'Marcar como não lido' : 'Marcar como lido';
            button.setAttribute('aria-label', `${label}: ${book.title}`);
            button.title = label;
            button.querySelector('.reading-tooltip').textContent = book.is_read ? 'Lido · marcar como não lido' : 'Não lido · marcar como lido';
            button.querySelector('use').setAttribute('href', book.is_read ? '#eye-open' : '#eye-closed');
            document.querySelectorAll(`.black-book[data-book-id="${book.id}"]`).forEach(card => {
                card.classList.toggle('read', book.is_read);
                card.querySelector('.black-book-state').textContent = book.is_read ? 'Lido' : 'Não lido';
            });
            const shelfCount = document.querySelector('.shelf-count');
            if (shelfCount) shelfCount.textContent = `${document.querySelectorAll('.black-book.read').length} / ${document.querySelectorAll('.black-book').length} lidos`;
            const status = new URLSearchParams(location.search).get('status');
            if ((status === 'unread' && book.is_read) || (status === 'read' && !book.is_read)) {
                const next = row.nextElementSibling?.querySelector('.check');
                row.remove();
                const list = document.querySelector('.book-list');
                if (!list.children.length) {
                    const empty = document.createElement('li');
                    empty.className = 'empty';
                    empty.textContent = 'Nenhum livro encontrado nos arquivos de Apocrypha...';
                    list.append(empty);
                }
                (next || document.querySelector('.library')).focus({ preventScroll: true });
            }
        } catch (error) {
            feedback('Não foi possível confirmar a alteração. Atualize a página antes de tentar novamente.');
        } finally {
            button.disabled = false;
            button.removeAttribute('aria-busy');
        }
    });
    document.addEventListener('click', event => {
        const link = event.target.closest('.quick-filters a, .black-book');
        if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(link.href);
    });
    window.addEventListener('popstate', () => navigate(location.href, false));
})();
