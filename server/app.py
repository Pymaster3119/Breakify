from flask import Flask, request, jsonify, send_from_directory, abort, session
from flask_cors import CORS
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
from ultralytics import YOLO
import torch
import os

app = Flask(__name__)
# Secret key for session cookies (use env var in production)
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(24)
# Allow cross-origin requests; allow credentials for cookie-based sessions
CORS(app, supports_credentials=True)

# --- simple sqlite user storage for hashed passwords ---
# place users.db next to this file
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'users.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        cur.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        ''')
        # sessions table: records each finished work session for a user
        cur.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            duration_seconds INTEGER NOT NULL,
            phone_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        ''')
        conn.commit()
    finally:
        conn.close()

def find_user(username):
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        cur.execute('SELECT id, username, password_hash, created_at FROM users WHERE username = ?', (username,))
        row = cur.fetchone()
        if not row:
            return None
        return {'id': row[0], 'username': row[1], 'password_hash': row[2], 'created_at': row[3]}
    finally:
        conn.close()

def create_user(username, password):
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        pw_hash = generate_password_hash(password)
        now = datetime.utcnow().isoformat()
        cur.execute('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)', (username, pw_hash, now))
        conn.commit()
        return True
    finally:
        conn.close()


def record_session_for_user(username, duration_seconds, phone_count=0):
    # find user id
    user = find_user(username)
    if not user:
        raise ValueError('no such user')
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        now = datetime.utcnow().isoformat()
        cur.execute('INSERT INTO sessions (user_id, duration_seconds, phone_count, created_at) VALUES (?, ?, ?, ?)', (user['id'], int(duration_seconds), int(phone_count), now))
        conn.commit()
    finally:
        conn.close()


def get_user_stats(username, limit=20):
    user = find_user(username)
    if not user:
        return None
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        cur.execute('SELECT SUM(duration_seconds) FROM sessions WHERE user_id = ?', (user['id'],))
        total = cur.fetchone()[0] or 0
        cur.execute('SELECT id, duration_seconds, phone_count, created_at FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT ?', (user['id'], limit))
        rows = cur.fetchall()
        recent = [{'id': r[0], 'duration_seconds': r[1], 'phone_count': r[2], 'created_at': r[3]} for r in rows]
        return {'total_seconds': int(total), 'recent_sessions': recent}
    finally:
        conn.close()

# initialize DB at startup
init_db()

# Load YOLO model (will download if not present)
MODEL_PATH = "yolov10s.pt"
if torch.backends.mps.is_available() and torch.backends.mps.is_built():
    DEVICE = 'mps'
elif torch.cuda.is_available():
    DEVICE = 'cuda'
else:
    DEVICE = 'cpu'

print(f"Loading model on device: {DEVICE}")
model = YOLO(MODEL_PATH)

try:
    try:
        model.to(DEVICE)
    except Exception:
        # fallback: access underlying model attribute
        if hasattr(model, 'model'):
            try:
                model.model.to(DEVICE)
            except Exception:
                pass
except Exception:
    # not fatal; inference will try to run on default device
    pass

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

    # Run YOLO inference on the saved image
    try:
        results = model(last_path)
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
        return jsonify({'ok': True, 'user': {'name': username}})
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
    return jsonify({'ok': True, 'user': {'name': username}})


@app.route('/api/me')
def api_me():
    username = session.get('user')
    if not username:
        return jsonify({'user': None})
    return jsonify({'user': {'name': username}})


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.pop('user', None)
    return jsonify({'ok': True})


if __name__ == "__main__":
    port = int(os.environ.get('PORT', 6767))
    app.run(host='0.0.0.0', port=port, debug=True)