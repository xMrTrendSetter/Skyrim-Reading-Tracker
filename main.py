import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine
from models import Book

BASE_DIR = Path(__file__).resolve().parent


def load_initial_books(db: Session) -> None:
    with open(BASE_DIR / "books_data.json", "r", encoding="utf-8") as f:
        books = json.load(f)
    existing = {title for (title,) in db.query(Book.title).all()}
    for book in books:
        if book["title"] not in existing:
            db.add(Book(title=book["title"], author=book.get("author")))
    db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        load_initial_books(db)
    yield


app = FastAPI(title="Skyrim Reading Tracker", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/", response_class=HTMLResponse)
def home(request: Request, q: str = "", status: str = "", campo: str = "all",
         db: Session = Depends(get_db)):
    query = db.query(Book)
    if q:
        padrao = f"%{q}%"
        if campo == "title":
            query = query.filter(Book.title.ilike(padrao))
        elif campo == "author":
            query = query.filter(Book.author.ilike(padrao))
        else:
            query = query.filter(
                or_(Book.title.ilike(padrao), Book.author.ilike(padrao))
            )
    if status == "read":
        query = query.filter(Book.is_read.is_(True))
    elif status == "unread":
        query = query.filter(Book.is_read.is_(False))
    books = query.order_by(Book.title).all()

    total = db.query(Book).count()
    read_count = db.query(Book).filter(Book.is_read.is_(True)).count()

    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "books": books,
            "total": total,
            "read_count": read_count,
            "q": q,
            "status": status,
            "campo": campo,
            "black_books": db.query(Book).filter(Book.title.startswith("Black Book: ")).order_by(Book.title).all(),
        },
    )


@app.post("/toggle/{book_id}")
def toggle_read(book_id: int, request: Request, db: Session = Depends(get_db)):
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Livro não encontrado")
    book.is_read = not book.is_read
    db.commit()
    if request.headers.get("accept") == "application/json":
        return JSONResponse({
            "id": book.id, "is_read": book.is_read, "title": book.title,
            "read_count": db.query(Book).filter(Book.is_read.is_(True)).count(),
            "total": db.query(Book).count(),
        })
    return RedirectResponse(url="/", status_code=303)
