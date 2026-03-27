from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc

from database import get_db
from models import Moment
from schemas import MomentCreate, MomentResponse

router = APIRouter(prefix="/api/moments", tags=["moments"])


@router.get("/", response_model=list[MomentResponse])
def get_moments(db: Session = Depends(get_db)):
    return db.query(Moment).order_by(desc(Moment.created_at)).all()


@router.post("/", response_model=MomentResponse, status_code=201)
def create_moment(payload: MomentCreate, db: Session = Depends(get_db)):
    moment = Moment(**payload.model_dump())
    db.add(moment)
    db.commit()
    db.refresh(moment)
    return moment


@router.delete("/{moment_id}", status_code=204)
def delete_moment(moment_id: int, db: Session = Depends(get_db)):
    moment = db.get(Moment, moment_id)
    if not moment:
        raise HTTPException(status_code=404, detail="Moment not found")
    db.delete(moment)
    db.commit()
