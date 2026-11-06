"""Exercise the real ASGI routes with an isolated, in-memory reading database."""
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from main import app, get_db, load_initial_books
from database import Base
from models import Book

engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
with Session() as db:
    db.add_all([Book(id=1, title='A Brief History', author='Stronach', is_read=False),
                Book(id=2, title='The Real Barenziah', author='Anonymous', is_read=True),
                Book(id=3, title='An <Ancient> Book', author='Stronach', is_read=False)])
    db.commit()

def isolated_db():
    with Session() as db:
        yield db

app.dependency_overrides[get_db] = isolated_db

async def request(path='/', query='', method='GET', headers=None):
    messages = []
    async def receive():
        return {'type': 'http.request', 'body': b'', 'more_body': False}
    async def send(message):
        messages.append(message)
    await app({'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.4'},
               'http_version': '1.1', 'method': method, 'scheme': 'http',
               'path': path, 'raw_path': path.encode(), 'query_string': query.encode(),
               'root_path': '', 'headers': headers or [], 'client': ('127.0.0.1', 1),
               'server': ('test', 80)}, receive, send)
    status = next(m['status'] for m in messages if m['type'] == 'http.response.start')
    body = b''.join(m.get('body', b'') for m in messages).decode()
    return status, body

async def main():
    status, body = await request()
    assert status == 200 and body.count('class="check"') == 3
    assert '<strong data-read-count>1</strong> de <strong data-total-count>3</strong>' in body
    assert 'An &lt;Ancient&gt; Book' in body
    _, body = await request(query='q=Stronach&campo=author&status=unread')
    assert body.count('class="check"') == 2
    assert 'q=Stronach&amp;campo=author&amp;status=read' in body
    _, body = await request(query='q=Barenziah&campo=title')
    assert body.count('class="check"') == 1
    _, body = await request(query='status=read')
    assert body.count('class="check"') == 1 and 'aria-pressed="true"' in body
    _, body = await request(query='q=missing-title')
    assert 'Nenhum livro encontrado' in body and 'class="check"' not in body
    status, _ = await request('/toggle/1', method='POST')
    assert status == 303
    with Session() as db:
        assert db.get(Book, 1).is_read
    _, body = await request()
    assert '<strong data-read-count>2</strong> de <strong data-total-count>3</strong>' in body
    status, body = await request('/toggle/1', method='POST', headers=[(b'accept', b'application/json')])
    assert status == 200
    result = json.loads(body)
    assert result == {'id': 1, 'is_read': False, 'title': 'A Brief History', 'read_count': 1, 'total': 3}
    status, _ = await request('/toggle/99999', method='POST', headers=[(b'accept', b'application/json')])
    assert status == 404
    with Session() as db:
        load_initial_books(db)
        count = db.query(Book).count()
        assert count >= 400
        assert db.query(Book).filter(Book.title.startswith('Black Book: ')).count() == 7
        old = db.query(Book).filter_by(title='Black Book: Waking Dreams').one()
        old.is_read = True
        old_id = old.id
        db.commit()
        load_initial_books(db)
        assert db.query(Book).count() == count
        assert db.get(Book, old_id).is_read
        assert db.query(Book).filter(Book.title.startswith('The Poison Song, Book ')).count() == 7
        assert db.query(Book).filter_by(title="Feyfolken, Book I").count() == 0
        assert db.query(Book).filter_by(title='Beggar').count() == 0
        assert db.query(Book).filter_by(title='Beggar (Eslaf Erol)').count() == 1
    catalog = json.loads((Path(__file__).resolve().parents[1] / 'books_data.json').read_text(encoding='utf-8'))
    assert len({b['title'].casefold() for b in catalog}) == len(catalog)
    status, body = await request(query='q=Black+Book&campo=title')
    assert status == 200 and body.count('class="check"') == 7
    assert body.count('class="black-book ') == 7
    print('PASS: catalog expansion, normalized duplicate checks, seed idempotence, preserved progress, seven Black Books, search, filters, HTML/JSON reading updates and counts. Isolated database only.')

try:
    asyncio.run(main())
finally:
    app.dependency_overrides.pop(get_db, None)
    engine.dispose()
