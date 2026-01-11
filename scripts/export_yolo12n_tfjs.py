from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ultralytics import YOLO
import ultralytics


def parse_args() -> argparse.Namespace:
  p = argparse.ArgumentParser(description='Export YOLO v12n to TensorFlow.js format')
  p.add_argument('--weights', default='server/yolo12n.pt', help='Path to *.pt weights')
  p.add_argument('--output', default='public/models/yolo12n', help='Output directory for TFJS files')
  p.add_argument('--imgsz', type=int, default=640, help='Square inference size used during export')
  p.add_argument('--device', default='cpu', help='Device for export: cpu, cuda, mps')
  return p.parse_args()


def main() -> int:
  args = parse_args()
  weights_path = Path(args.weights).expanduser().resolve()
  if not weights_path.exists():
    print(f"Weights not found: {weights_path}", file=sys.stderr)
    return 1

  out_dir = Path(args.output).expanduser().resolve()
  out_dir.mkdir(parents=True, exist_ok=True)

  try:
    ulv = getattr(ultralytics, '__version__', '0.0.0')
  except Exception:
    ulv = '0.0.0'
  print(f"Using ultralytics {ulv}")
  def parse_ver(s: str):
    try:
      parts = s.split('.')
      return tuple(int(p) for p in parts[:3]) + (0,) * (3 - len(parts[:3]))
    except Exception:
      return (0, 0, 0)
  if parse_ver(ulv) < parse_ver('8.2.0'):
    print("ERROR: ultralytics >= 8.2.0 is required to export YOLO v12 models (missing modules like C3k2).", file=sys.stderr)
    print("Fix: pip install -U ultralytics tensorflowjs torch torchvision", file=sys.stderr)
    return 2

  print(f"Loading model from {weights_path}")
  try:
    model = YOLO(str(weights_path))
  except Exception as e:
    print("Failed to load YOLO weights. This usually means your ultralytics version is too old for YOLO v12n.", file=sys.stderr)
    print(f"Detail: {e}", file=sys.stderr)
    print("Try: pip install -U ultralytics tensorflowjs torch torchvision", file=sys.stderr)
    return 3

  print(f"Exporting TFJS model to {out_dir} (imgsz={args.imgsz}, device={args.device})")
  # ultralytics export will create the directory {project}/{name}; we keep that aligned to out_dir
  model.export(
    format='tfjs',
    imgsz=args.imgsz,
    device=args.device,
    project=str(out_dir.parent),
    name=out_dir.name,
    exist_ok=True,
  )

  print('Done. Files written to:', out_dir)
  print('Ensure the frontend points VITE_YOLO12N_MODEL_URL to /models/yolo12n/model.json (or leave default).')
  return 0


if __name__ == '__main__':
  raise SystemExit(main())
   