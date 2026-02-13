from flask import Flask, request, jsonify, send_from_directory, abort, session, make_response
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import jwt
from ultralytics import YOLO
import torch
import os

# SQLAlchemy / PostgreSQL
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, func, Boolean, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from sqlalchemy.exc import SQLAlchemyError


app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(24)

FRONTEND_ORIGIN = os.environ.get('FRONTEND_ORIGIN', 'https://breakify-3d5p.onrender.com')

# SESSION_COOKIE_SECURE should be True in production (when DEV is not set)
IS_DEV = os.environ.get('DEV', '').lower() in ('1', 'true', 'yes')

app.config.update(
    SESSION_COOKIE_SECURE=not IS_DEV,
    SESSION_COOKIE_SAMESITE='None' if not IS_DEV else 'Lax',
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_DOMAIN=None,  # Let browser handle domain
)

JWT_SECRET = os.environ.get('JWT_SECRET') or (app.secret_key if isinstance(app.secret_key, str) else 'change-me')
JWT_ALG = 'HS256'
JWT_TTL_SECONDS = int(os.environ.get('JWT_TTL_SECONDS', '604800'))  # default 7 days

# CORS configuration with explicit resource configuration
CORS(app, 
     supports_credentials=True, 
     origins=[FRONTEND_ORIGIN],
     allow_headers=['Content-Type', 'Authorization'],
     expose_headers=['Set-Cookie'],
     methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])

PROVIDED_INTERNAL_DB_URL = 'postgresql://neondb_owner:npg_0h8rlLmkMeTy@ep-damp-wave-aenvz5j9-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
DATABASE_URL = os.environ.get('DATABASE_URL', PROVIDED_INTERNAL_DB_URL)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    email = Column(String, nullable=True)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False)

    # Optional FK to schools table (nullable to allow existing users to remain)
    school_id = Column(Integer, ForeignKey('schools.id'), nullable=True)
    school = relationship('School', back_populates='users')

    sessions = relationship('WorkSession', back_populates='user', cascade='all, delete-orphan')
    settings = relationship('UserSettings', uselist=False, back_populates='user', cascade='all, delete-orphan')


class WorkSession(Base):
    __tablename__ = 'sessions'
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    duration_seconds = Column(Integer, nullable=False)
    phone_count = Column(Integer, nullable=False, default=0)
    distracted_seconds = Column(Integer, nullable=True, default=0)
    focused_seconds = Column(Integer, nullable=True, default=0)
    unfocused = Column(Boolean, nullable=True, default=False)
    created_at = Column(DateTime, nullable=False)
    user = relationship('User', back_populates='sessions')


class UserSettings(Base):
    __tablename__ = 'user_settings'
    user_id = Column(Integer, ForeignKey('users.id'), primary_key=True)
    work_minutes = Column(Integer, nullable=False, default=30)
    break_minutes = Column(Integer, nullable=False, default=10)
    updated_at = Column(DateTime, nullable=False)
    user = relationship('User', back_populates='settings')


class School(Base):
    __tablename__ = 'schools'
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, nullable=False)
    users = relationship('User', back_populates='school', cascade='all, delete-orphan')


def init_db():
    """Create missing tables and perform safe (non-destructive) migrations.
    - creates `schools` table if missing
    - adds `school_id` column to `users` when absent (nullable)
    """
    # Create any missing tables declared in models
    Base.metadata.create_all(bind=engine)

    # Use inspector to detect whether 'school_id' column already exists on users
    try:
        inspector = inspect(engine)
        if 'users' in inspector.get_table_names():
            cols = [c['name'] for c in inspector.get_columns('users')]
            if 'school_id' not in cols:
                # add nullable integer column and FK constraint
                with engine.connect() as conn:
                    conn.execute(text('ALTER TABLE users ADD COLUMN school_id INTEGER'))
                    # Add FK constraint (ignore if DB disallows or it already exists)
                    try:
                        conn.execute(text('ALTER TABLE users ADD CONSTRAINT users_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools (id)'))
                    except Exception:
                        # non-fatal; some DBs may implicitly add FK or constraints may differ
                        pass
                    conn.commit()
    except Exception:
        # If inspection or ALTER fails, don't crash app start; log to stdout
        print('Warning: could not perform schema migration for school_id; you may need to ALTER your users table manually.')


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
        return {
            'id': u.id,
            'username': u.username,
            'email': u.email,
            'password_hash': u.password_hash,
            'created_at': u.created_at,
            'school_id': int(u.school_id) if getattr(u, 'school_id', None) is not None else None,
            'school_name': (u.school.name if getattr(u, 'school', None) is not None else None)
        }
    finally:
        db.close()

def create_user(username, password, email=None, school_id=None, school_name=None):
    db = SessionLocal()
    try:
        pw_hash = generate_password_hash(password)
        now = datetime.utcnow()

        # if school_name provided, try to find-or-create the school
        resolved_school_id = None
        if school_name:
            s = db.query(School).filter(func.lower(School.name) == school_name.strip().lower()).first()
            if not s:
                s = School(name=school_name.strip(), created_at=now)
                db.add(s)
                db.flush()  # populate s.id
            resolved_school_id = s.id
        elif school_id:
            resolved_school_id = int(school_id)

        u = User(username=username, password_hash=pw_hash, email=email, created_at=now, school_id=resolved_school_id)
        db.add(u)
        db.commit()
        return True
    except SQLAlchemyError:
        db.rollback()
        raise
    finally:
        db.close()


def record_session_for_user(username, duration_seconds, phone_count=0, distracted_seconds=0, focused_seconds=0, unfocused=False):
    user = find_user(username)
    if not user:
        raise ValueError('no such user')
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        s = WorkSession(
            user_id=user['id'],
            duration_seconds=int(duration_seconds),
            phone_count=int(phone_count),
            distracted_seconds=int(distracted_seconds or 0),
            focused_seconds=int(focused_seconds or 0),
            unfocused=bool(unfocused),
            created_at=now
        )
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


def issue_jwt(username):
    now = datetime.utcnow()
    payload = {
        'sub': username,
        'iat': now,
        'exp': now + timedelta(seconds=JWT_TTL_SECONDS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def current_username():
    # Prefer Bearer token if provided
    auth_header = request.headers.get('Authorization', '') or ''
    if auth_header.lower().startswith('bearer '):
        token = auth_header.split(' ', 1)[1].strip()
        if token:
            try:
                decoded = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
                return decoded.get('sub')
            except jwt.ExpiredSignatureError:
                return None
            except jwt.InvalidTokenError:
                return None
    # Fallback to session cookie
    return session.get('user')


def get_user_stats(username, limit=20):
    user = find_user(username)
    if not user:
        return None
    db = SessionLocal()
    try:
        # Use focused_seconds as the authoritative total for "focused" leaderboard/statistics
        total = db.query(func.coalesce(func.sum(WorkSession.focused_seconds), 0)).filter(WorkSession.user_id == user['id']).scalar() or 0
        rows = db.query(WorkSession).filter(WorkSession.user_id == user['id']).order_by(WorkSession.id.desc()).limit(limit).all()
        recent = [{'id': r.id, 'duration_seconds': r.duration_seconds, 'phone_count': r.phone_count, 'distracted_seconds': getattr(r, 'distracted_seconds', 0) or 0, 'focused_seconds': getattr(r, 'focused_seconds', 0) or 0, 'unfocused': bool(getattr(r, 'unfocused', False)), 'created_at': r.created_at.isoformat()} for r in rows]
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
    email = (data.get('email') or '').strip()
    # school information can be provided as school_id or school_name
    school_id = data.get('school_id')
    school_name = (data.get('school_name') or '').strip() or None

    if not username or not password:
        return jsonify({'error': 'username and password required'}), 400
    if len(username) < 3 or len(password) < 6:
        return jsonify({'error': 'username must be >=3 and password >=6 chars'}), 400
    if find_user(username):
        return jsonify({'error': 'user exists'}), 400
    try:
        create_user(username, password, email, school_id=school_id, school_name=school_name)
        session['user'] = username
        session.modified = True  # Ensure session is marked as modified
        token = issue_jwt(username)
        # include school info in response
        created_user = find_user(username)
        resp = make_response(jsonify({'ok': True, 'user': {'name': username, 'school_id': created_user.get('school_id'), 'school_name': created_user.get('school_name')}, 'token': token}))
        resp.headers['Access-Control-Allow-Credentials'] = 'true'
        resp.headers['Access-Control-Allow-Origin'] = FRONTEND_ORIGIN
        return resp
    except Exception as e:
        return jsonify({'error': 'failed to create user', 'detail': str(e)}), 500


@app.route('/api/session', methods=['POST'])
def api_session():
    # record a finished work session for the logged-in user
    username = current_username()
    if not username:
        return jsonify({'error': 'not authenticated'}), 401
    data = request.get_json() or {}
    duration = int(data.get('duration_seconds') or 0)
    phone_count = int(data.get('phone_count') or 0)
    # optional extended metrics
    try:
        distracted_seconds = int(data.get('distracted_seconds') or 0)
    except Exception:
        distracted_seconds = 0
    try:
        focused_seconds = int(data.get('focused_seconds') or 0)
    except Exception:
        focused_seconds = 0
    # accept boolean-ish unfocused values
    unfocused_raw = data.get('unfocused')
    unfocused = (unfocused_raw is True) or (str(unfocused_raw).lower() in ('1', 'true', 'yes'))
    if duration <= 0:
        return jsonify({'error': 'invalid duration'}), 400
    try:
        record_session_for_user(username, duration, phone_count, distracted_seconds=distracted_seconds, focused_seconds=focused_seconds, unfocused=unfocused)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': 'failed to record session', 'detail': str(e)}), 500


@app.route('/api/stats')
def api_stats():
    username = current_username()
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
        # Rank users by total focused seconds (focused_seconds)
        q = (
            db.query(
                User.username,
                func.coalesce(func.sum(WorkSession.focused_seconds), 0).label('total_seconds'),
                func.count(WorkSession.id).label('session_count'),
            )
            .outerjoin(WorkSession, User.id == WorkSession.user_id)
            .group_by(User.id)
            .order_by(func.coalesce(func.sum(WorkSession.focused_seconds), 0).desc())
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
    session.modified = True  # Ensure session is marked as modified
    token = issue_jwt(username)
    resp = make_response(jsonify({'ok': True, 'user': {'name': username, 'school_id': user.get('school_id'), 'school_name': user.get('school_name')}, 'token': token}))
    resp.headers['Access-Control-Allow-Credentials'] = 'true'
    resp.headers['Access-Control-Allow-Origin'] = FRONTEND_ORIGIN
    return resp


@app.route('/api/me')
def api_me():
    username = current_username()
    if not username:
        resp = make_response(jsonify({'user': None}))
    else:
        u = find_user(username)
        resp = make_response(jsonify({'user': {'name': username, 'school_id': u.get('school_id'), 'school_name': u.get('school_name')}}))
    resp.headers['Access-Control-Allow-Credentials'] = 'true'
    resp.headers['Access-Control-Allow-Origin'] = FRONTEND_ORIGIN
    return resp


@app.route('/api/settings', methods=['GET', 'POST'])
def api_settings():
    username = current_username()
    if not username:
        resp = make_response(jsonify({'error': 'not authenticated'}), 401)
        resp.headers['Access-Control-Allow-Credentials'] = 'true'
        resp.headers['Access-Control-Allow-Origin'] = FRONTEND_ORIGIN
        return resp
    if request.method == 'GET':
        try:
            s = get_user_settings(username)
            resp = make_response(jsonify({'ok': True, 'settings': s}))
            resp.headers['Access-Control-Allow-Credentials'] = 'true'
            resp.headers['Access-Control-Allow-Origin'] = FRONTEND_ORIGIN
            return resp
        except Exception as e:
            resp = make_response(jsonify({'error': 'failed to load settings', 'detail': str(e)}), 500)
            resp.headers['Access-Control-Allow-Credentials'] = 'true'
            resp.headers['Access-Control-Allow-Origin'] = FRONTEND_ORIGIN
            return resp

    # POST: set new settings
    data = request.get_json() or {}
    try:
        work = int(data.get('work_minutes') or 30)
        brk = int(data.get('break_minutes') or 10)
        if work <= 0 or brk <= 0:
            resp = make_response(jsonify({'error': 'invalid values'}), 400)
            resp.headers['Access-Control-Allow-Credentials'] = 'true'
            resp.headers['Access-Control-Allow-Origin'] = FRONTEND_ORIGIN
            return resp
        set_user_settings(username, work, brk)
        resp = make_response(jsonify({'ok': True}))
        resp.headers['Access-Control-Allow-Credentials'] = 'true'
        resp.headers['Access-Control-Allow-Origin'] = FRONTEND_ORIGIN
        return resp
    except Exception as e:
        resp = make_response(jsonify({'error': 'failed to save settings', 'detail': str(e)}), 500)
        resp.headers['Access-Control-Allow-Credentials'] = 'true'
        resp.headers['Access-Control-Allow-Origin'] = FRONTEND_ORIGIN
        return resp


@app.route('/api/schools', methods=['GET', 'POST'])
def api_schools():
    # GET: list schools, POST: create a new school
    if request.method == 'GET':
        db = SessionLocal()
        try:
            rows = db.query(School).order_by(School.name.asc()).all()
            out = [{'id': r.id, 'name': r.name} for r in rows]
            resp = make_response(jsonify({'ok': True, 'schools': out}))
            resp.headers['Access-Control-Allow-Credentials'] = 'true'
            resp.headers['Access-Control-Allow-Origin'] = FRONTEND_ORIGIN
            return resp
        finally:
            db.close()

    # POST
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name required'}), 400
    db = SessionLocal()
    try:
        existing = db.query(School).filter(func.lower(School.name) == name.lower()).first()
        if existing:
            return jsonify({'ok': True, 'school': {'id': existing.id, 'name': existing.name}})
        now = datetime.utcnow()
        s = School(name=name, created_at=now)
        db.add(s)
        db.commit()
        return jsonify({'ok': True, 'school': {'id': s.id, 'name': s.name}})
    except Exception as e:
        db.rollback()
        return jsonify({'error': 'failed to create school', 'detail': str(e)}), 500
    finally:
        db.close()


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.pop('user', None)
    resp = make_response(jsonify({'ok': True}))
    resp.set_cookie(app.session_cookie_name, '', expires=0, path='/')
    return resp


if __name__ == "__main__":
    port = int(os.environ.get('PORT', 6767))
    app.run(host='0.0.0.0', port=port)