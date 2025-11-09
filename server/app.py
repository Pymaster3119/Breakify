from flask import Flask, request, jsonify, send_from_directory, abort
from flask_cors import CORS
from ultralytics import YOLO
import torch
import os

app = Flask(__name__)
CORS(app)

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


if __name__ == "__main__":
    port = int(os.environ.get('PORT', 6767))
    app.run(host='0.0.0.0', port=port, debug=True)