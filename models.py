from sqlalchemy import Boolean, Column, Integer, String

from database import Base


class Book(Base):
    __tablename__ = "books"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, unique=True, index=True)
    author = Column(String, nullable=True)
    is_read = Column(Boolean, default=False)