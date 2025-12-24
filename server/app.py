from flask import Flask, request, jsonify, send_from_directory, abort, session, make_response
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
from ultralytics import YOLO
import torch
import os

# SQLAlchemy / PostgreSQL
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from sqlalchemy.exc import SQLAlchemyError
from flask.sessions import SecureCookieSessionInterface


app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(24)

FRONTEND_ORIGIN = os.environ.get('FRONTEND_ORIGIN', 'https://breakify-orcin.vercel.app')

app.config.update(
    SESSION_COOKIE_SECURE=not os.environ.get('DEV', '') ,
    SESSION_COOKIE_SAMESITE='None',
    SESSION_COOKIE_HTTPONLY=True,
)
CORS(app, supports_credentials=True, origins=[FRONTEND_ORIGIN])

PROVIDED_INTERNAL_DB_URL = 'postgresql://neondb_owner:npg_4xoZlbS0UNIC@ep-damp-base-adoyetgg-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require'
DATABASE_URL = os.environ.get('DATABASE_URL', PROVIDED_INTERNAL_DB_URL)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False)
    sessions = relationship('WorkSession', back_populates='user', cascade='all, delete-orphan')
    settings = relationship('UserSettings', uselist=False, back_populates='user', cascade='all, delete-orphan')


class WorkSession(Base):
    __tablename__ = 'sessions'
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    duration_seconds = Column(Integer, nullable=False)
    phone_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False)
    user = relationship('User', back_populates='sessions')


class UserSettings(Base):
    __tablename__ = 'user_settings'
    user_id = Column(Integer, ForeignKey('users.id'), primary_key=True)
    work_minutes = Column(Integer, nullable=False, default=30)
    break_minutes = Column(Integer, nullable=False, default=10)
    updated_at = Column(DateTime, nullable=False)
    user = relationship('User', back_populates='settings')


def init_db():
    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)


def set_session_cookie(resp):
    try:
        ssi = SecureCookieSessionInterface()
        serializer = ssi.get_signing_serializer(app)
        if not serializer:
            return resp
        cookie_val = serializer.dumps(dict(session))
        secure_flag = bool(app.config.get('SESSION_COOKIE_SECURE'))
        resp.set_cookie(app.session_cookie_name, cookie_val,
                        httponly=bool(app.config.get('SESSION_COOKIE_HTTPONLY', True)),
                        secure=secure_flag,
                        samesite='None',
                        path='/')
    except Exception:
        pass
    return resp


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def find_user(username):
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.username == username).first()
        if not u:
            return None
        return {'id': u.id, 'username': u.username, 'password_hash': u.password_hash, 'created_at': u.created_at}
    finally:
        db.close()

def create_user(username, password):
    db = SessionLocal()
    try:
        pw_hash = generate_password_hash(password)
        now = datetime.utcnow()
        u = User(username=username, password_hash=pw_hash, created_at=now)
        db.add(u)
        db.commit()
        return True
    except SQLAlchemyError:
        db.rollback()
        raise
    finally:
        db.close()


def record_session_for_user(username, duration_seconds, phone_count=0):
    user = find_user(username)
    if not user:
        raise ValueError('no such user')
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        s = WorkSession(user_id=user['id'], duration_seconds=int(duration_seconds), phone_count=int(phone_count), created_at=now)
        db.add(s)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    finally:
        db.close()


def get_user_settings(username):
    user = find_user(username)
    if not user:
        return None
    db = SessionLocal()
    try:
        s = db.query(UserSettings).filter(UserSettings.user_id == user['id']).first()
        if not s:
            return {'work_minutes': 30, 'break_minutes': 10}
        return {'work_minutes': int(s.work_minutes), 'break_minutes': int(s.break_minutes)}
    finally:
        db.close()


def set_user_settings(username, work_minutes, break_minutes):
    user = find_user(username)
    if not user:
        raise ValueError('no such user')
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        s = db.query(UserSettings).filter(UserSettings.user_id == user['id']).first()
        if s:
            s.work_minutes = int(work_minutes)
            s.break_minutes = int(break_minutes)
            s.updated_at = now
        else:
            s = UserSettings(user_id=user['id'], work_minutes=int(work_minutes), break_minutes=int(break_minutes), updated_at=now)
            db.add(s)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    finally:
        db.close()


def get_user_stats(username, limit=20):
    user = find_user(username)
    if not user:
        return None
    db = SessionLocal()
    try:
        total = db.query(func.coalesce(func.sum(WorkSession.duration_seconds), 0)).filter(WorkSession.user_id == user['id']).scalar() or 0
        rows = db.query(WorkSession).filter(WorkSession.user_id == user['id']).order_by(WorkSession.id.desc()).limit(limit).all()
        recent = [{'id': r.id, 'duration_seconds': r.duration_seconds, 'phone_count': r.phone_count, 'created_at': r.created_at.isoformat()} for r in rows]
        return {'total_seconds': int(total), 'recent_sessions': recent}
    finally:
        db.close()

# initialize DB (create tables) at startup
init_db()

# Load YOLO model (will download if not present)
MODEL_PATH = os.environ.get('YOLO_MODEL_PATH', 'yolov10n.pt')
if torch.backends.mps.is_available() and torch.backends.mps.is_built():
    DEVICE = 'mps'
elif torch.cuda.is_available():
    DEVICE = 'cuda'
else:
    DEVICE = 'cpu'

# Memory-friendly inference configuration (env-overridable)
IMG_SIZE = int(os.environ.get('YOLO_IMG_SIZE', '512'))
CONF = float(os.environ.get('YOLO_CONF', '0.25'))
IOU = float(os.environ.get('YOLO_IOU', '0.45'))
MAX_DET = int(os.environ.get('YOLO_MAX_DET', '50'))
# Use FP16 only on CUDA unless disabled via YOLO_FP16=0
USE_HALF = bool(torch.cuda.is_available() and os.environ.get('YOLO_FP16', '1') != '0')

_model = None

def get_model():
    global _model
    if _model is None:
        print(f"Loading model {MODEL_PATH} on device: {DEVICE}")
        m = YOLO(MODEL_PATH)
        try:
            m.to(DEVICE)
            # eval mode avoids grad buffers
            if hasattr(m, 'eval'):
                m.eval()
            # fuse conv+bn if supported (small memory/speed benefits)
            if hasattr(m, 'fuse'):
                try:
                    m.fuse()
                except Exception:
                    pass
        except Exception:
            # fallback: access underlying model attribute
            if hasattr(m, 'model'):
                try:
                    m.model.to(DEVICE)
                    if hasattr(m.model, 'eval'):
                        m.model.eval()
                except Exception:
                    pass
        _model = m
    return _model

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
CAPTURES_DIR = os.path.join(THIS_DIR, 'captures')
os.makedirs(CAPTURES_DIR, exist_ok=True)


@app.route("/")
def home():
    return "YOLO Flask server running!"


@app.route("/predict", methods=["POST"])
def predict():
    # Accept either 'image' or 'file' form fields (frontend uses 'image')
    key = 'image' if 'image' in request.files else ('file' if 'file' in request.files else None)
    if key is None:
        return jsonify({"error": "No file uploaded (expected form field 'image' or 'file')"}), 400

    file = request.files[key]

    # Save incoming frame as a single, fixed file (overwrite previous)
    try:
        last_path = os.path.join(CAPTURES_DIR, 'last.jpg')
        os.makedirs(CAPTURES_DIR, exist_ok=True)
        file.save(last_path)
    except Exception as e:
        return jsonify({"error": "Failed to save uploaded image", "detail": str(e)}), 500

    # Run YOLO inference on the saved image (memory-optimized)
    try:
        mdl = get_model()
        with torch.inference_mode():
            results = mdl.predict(
                last_path,
                imgsz=IMG_SIZE,
                conf=CONF,
                iou=IOU,
                max_det=MAX_DET,
                device=DEVICE,
                half=USE_HALF,
                verbose=False,
            )
        # free CUDA caches after inference to keep peak memory lower
        if DEVICE == 'cuda':
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass
    except Exception as e:
        return jsonify({"error": "Model inference failed", "detail": str(e)}), 500

    # Convert ultralytics results to detections list expected by frontend
    detections = []
    try:
        for result in results:
            # result.boxes may be iterable; each box has cls, conf, xyxy
            for box in getattr(result, 'boxes', []):
                # Some attributes are arrays/tensors; convert safely to python types
                try:
                    cls_val = int(box.cls[0]) if hasattr(box.cls, '__len__') else int(box.cls)
                except Exception:
                    cls_val = int(box.cls)
                try:
                    conf_val = float(box.conf[0]) if hasattr(box.conf, '__len__') else float(box.conf)
                except Exception:
                    conf_val = float(box.conf)
                try:
                    xy = box.xyxy[0].tolist() if hasattr(box.xyxy, '__len__') and hasattr(box.xyxy[0], 'tolist') else list(box.xyxy)
                except Exception:
                    # fallback: try to coerce
                    xy = [float(x) for x in box.xyxy]

                detections.append({
                    'class_id': cls_val,
                    'score': conf_val,
                    'bbox': [float(x) for x in xy]
                })
    except Exception as e:
        return jsonify({"error": "Failed to parse model results", "detail": str(e)}), 500

    return jsonify({"detections": detections})


@app.route('/last.jpg')
def serve_last_image():
    p = os.path.join(CAPTURES_DIR, 'last.jpg')
    if not os.path.exists(p):
        abort(404)
    return send_from_directory(CAPTURES_DIR, 'last.jpg')


@app.route('/api/register', methods=['POST'])
def api_register():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({'error': 'username and password required'}), 400
    if len(username) < 3 or len(password) < 6:
        return jsonify({'error': 'username must be >=3 and password >=6 chars'}), 400
    if find_user(username):
        return jsonify({'error': 'user exists'}), 400
    try:
        create_user(username, password)
        session['user'] = username
        resp = make_response(jsonify({'ok': True, 'user': {'name': username}}))
        resp = set_session_cookie(resp)
        return resp
    except Exception as e:
        return jsonify({'error': 'failed to create user', 'detail': str(e)}), 500


@app.route('/api/session', methods=['POST'])
def api_session():
    # record a finished work session for the logged-in user
    username = session.get('user')
    if not username:
        return jsonify({'error': 'not authenticated'}), 401
    data = request.get_json() or {}
    duration = int(data.get('duration_seconds') or 0)
    phone_count = int(data.get('phone_count') or 0)
    if duration <= 0:
        return jsonify({'error': 'invalid duration'}), 400
    try:
        record_session_for_user(username, duration, phone_count)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': 'failed to record session', 'detail': str(e)}), 500


@app.route('/api/stats')
def api_stats():
    username = session.get('user')
    if not username:
        return jsonify({'error': 'not authenticated'}), 401
    stats = get_user_stats(username)
    if stats is None:
        return jsonify({'error': 'no such user'}), 400
    return jsonify({'ok': True, 'stats': stats})


@app.route('/api/leaderboard')
def api_leaderboard():
    # Public endpoint: return users ordered by total worked seconds (desc)
    db = SessionLocal()
    try:
        q = (
            db.query(
                User.username,
                func.coalesce(func.sum(WorkSession.duration_seconds), 0).label('total_seconds'),
                func.count(WorkSession.id).label('session_count'),
            )
            .outerjoin(WorkSession, User.id == WorkSession.user_id)
            .group_by(User.id)
            .order_by(func.coalesce(func.sum(WorkSession.duration_seconds), 0).desc())
            .limit(100)
        )
        rows = q.all()
        result = [{'username': r[0], 'total_seconds': int(r[1]), 'session_count': int(r[2])} for r in rows]
        return jsonify({'ok': True, 'leaderboard': result})
    finally:
        db.close()


@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({'error': 'username and password required'}), 400
    user = find_user(username)
    if not user:
        return jsonify({'error': 'no such user'}), 400
    if not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'invalid credentials'}), 401
    session['user'] = username
    resp = make_response(jsonify({'ok': True, 'user': {'name': username}}))
    resp = set_session_cookie(resp)
    return resp


@app.route('/api/me')
def api_me():
    username = session.get('user')
    if not username:
        return jsonify({'user': None})
    return jsonify({'user': {'name': username}})


@app.route('/api/settings', methods=['GET', 'POST'])
def api_settings():
    username = session.get('user')
    if not username:
        return jsonify({'error': 'not authenticated'}), 401
    if request.method == 'GET':
        try:
            s = get_user_settings(username)
            return jsonify({'ok': True, 'settings': s})
        except Exception as e:
            return jsonify({'error': 'failed to load settings', 'detail': str(e)}), 500

    # POST: set new settings
    data = request.get_json() or {}
    try:
        work = int(data.get('work_minutes') or 30)
        brk = int(data.get('break_minutes') or 10)
        if work <= 0 or brk <= 0:
            return jsonify({'error': 'invalid values'}), 400
        set_user_settings(username, work, brk)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': 'failed to save settings', 'detail': str(e)}), 500


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.pop('user', None)
    resp = make_response(jsonify({'ok': True}))
    resp.set_cookie(app.session_cookie_name, '', expires=0, path='/')
    return resp


if __name__ == "__main__":
    port = int(os.environ.get('PORT', 6767))
    app.run(host='0.0.0.0', port=port)