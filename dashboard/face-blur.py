# 사진 속 사람 얼굴을 찾아 흐리게(블러) 처리한다.
# 사용: python face-blur.py --backup <원본보관폴더> <사진1> <사진2> ...
# 결과: 사진마다 {"file", "faces", "error"} 를 JSON 한 줄로 출력 (대시보드 서버가 읽는다)
# 얼굴 찾기: OpenCV YuNet (models/face_detection_yunet_2023mar.onnx)
import argparse
import json
import os
import shutil
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, "models", "face_detection_yunet_2023mar.onnx")
MAX_SIDE = 1600  # 얼굴 찾기는 줄인 사진으로 (큰 사진은 느리다)


def read_image(path):
    # 한글 경로는 cv2.imread 가 못 읽어서 바이트로 읽는다
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_UNCHANGED)  # 투명 배경(PNG 알파)도 그대로 읽는다


def write_image(path, img):
    ext = os.path.splitext(path)[1].lower() or ".jpg"
    params = [cv2.IMWRITE_JPEG_QUALITY, 92] if ext in (".jpg", ".jpeg") else []
    ok, buf = cv2.imencode(".jpg" if ext == ".jpeg" else ext, img, params)
    if not ok:
        raise RuntimeError("사진 저장 실패")
    buf.tofile(path)


def color_of(img):
    # 얼굴 찾기는 색 3채널로 (흑백·투명 PNG 대응)
    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        return cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    return img


def detect_faces(detector, img, threshold):
    img = color_of(img)
    h, w = img.shape[:2]
    scale = min(1.0, MAX_SIDE / max(h, w))
    small = cv2.resize(img, (int(w * scale), int(h * scale))) if scale < 1 else img
    detector.setInputSize((small.shape[1], small.shape[0]))
    detector.setScoreThreshold(threshold)
    _, faces = detector.detect(small)
    boxes = []
    if faces is not None:
        for f in faces:
            x, y, bw, bh = (f[:4] / scale).astype(int)
            boxes.append((x, y, bw, bh))
    return boxes


def blur_faces(img, boxes):
    h, w = img.shape[:2]
    out = img.copy()
    for x, y, bw, bh in boxes:
        # 머리카락·턱까지 가리도록 상자를 넉넉히 키운다
        pad_x, pad_y = int(bw * 0.3), int(bh * 0.35)
        x0, y0 = max(0, x - pad_x), max(0, y - pad_y)
        x1, y1 = min(w, x + bw + pad_x), min(h, y + bh + pad_y)
        if x1 <= x0 or y1 <= y0:
            continue
        roi = out[y0:y1, x0:x1]
        if roi.ndim == 3 and roi.shape[2] == 4:  # 투명도(알파)는 건드리지 않고 색만 흐리게
            roi = roi[..., :3]
        k = max(31, (max(x1 - x0, y1 - y0) // 3) | 1)  # 얼굴 크기에 맞춰 충분히 흐리게 (홀수)
        blurred = cv2.GaussianBlur(roi, (k, k), 0)
        blurred = cv2.GaussianBlur(blurred, (k, k), 0)
        # 네모가 아니라 타원 모양으로 자연스럽게
        mask = np.zeros(roi.shape[:2], dtype=np.uint8)
        cv2.ellipse(mask, ((x1 - x0) // 2, (y1 - y0) // 2), ((x1 - x0) // 2, (y1 - y0) // 2), 0, 0, 360, 255, -1)
        mask = cv2.GaussianBlur(mask, (21, 21), 0).astype(np.float32)[..., None] / 255.0
        if roi.ndim == 2:
            mask = mask[..., 0]
        mixed = (blurred * mask + roi * (1 - mask)).astype(np.uint8)
        if out.ndim == 3 and out.shape[2] == 4:
            out[y0:y1, x0:x1, :3] = mixed
        else:
            out[y0:y1, x0:x1] = mixed
    return out


def annotate(img, boxes, dst):
    # 얼굴 후보마다 번호 상자를 그린 확인용 사진 (Claude가 보고 진짜 사람 얼굴만 고른다)
    img = color_of(img)
    h, w = img.shape[:2]
    r = 1400 / max(h, w)
    out = cv2.resize(img, (int(w * r), int(h * r)))
    for i, (x, y, bw, bh) in enumerate(boxes, 1):
        p0, p1 = (int(x * r), int(y * r)), (int((x + bw) * r), int((y + bh) * r))
        cv2.rectangle(out, p0, p1, (0, 0, 255), 2)
        for color, thick in (((255, 255, 255), 4), ((0, 0, 255), 2)):
            cv2.putText(out, str(i), (p0[0], max(14, p0[1] - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, thick)
    cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tofile(dst)


def backup_and_blur(path, img, boxes, backup):
    if backup:
        os.makedirs(backup, exist_ok=True)
        dst = os.path.join(backup, os.path.basename(path))
        if not os.path.exists(dst):  # 처음 원본만 보관 (두 번 블러해도 원본은 그대로)
            shutil.copy2(path, dst)
    write_image(path, blur_faces(img, boxes))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backup", default="")
    ap.add_argument("--threshold", type=float, default=0.85)  # 0.85: 그림 속 얼굴은 대부분 건너뜀, 낮추면 더 꼼꼼하게
    ap.add_argument("--detect-only", action="store_true")
    # 2단계 방식: --annotate-dir 로 후보 상자 사진을 만들고, 확인된 상자만 --apply-json 으로 블러한다
    ap.add_argument("--annotate-dir", default="")
    ap.add_argument("--apply-json", default="")  # {"사진 경로": [[x,y,w,h], ...]}
    ap.add_argument("files", nargs="*")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    if args.apply_json:
        with open(args.apply_json, encoding="utf-8") as f:
            plan = json.load(f)
        for path, boxes in plan.items():
            result = {"file": os.path.basename(path), "faces": len(boxes)}
            try:
                img = read_image(path)
                if img is None:
                    raise RuntimeError("사진을 읽지 못했습니다")
                if boxes:
                    backup_and_blur(path, img, [tuple(b) for b in boxes], args.backup)
            except Exception as e:
                result["error"] = str(e)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        return
    detector = cv2.FaceDetectorYN.create(MODEL, "", (320, 320), args.threshold, 0.3, 5000)
    for n, path in enumerate(args.files):
        if args.annotate_dir:
            result = {"path": path, "file": os.path.basename(path), "boxes": []}
            try:
                img = read_image(path)
                if img is None:
                    raise RuntimeError("사진을 읽지 못했습니다")
                boxes = detect_faces(detector, img, args.threshold)
                result["boxes"] = [[int(v) for v in b] for b in boxes]
                if boxes:
                    os.makedirs(args.annotate_dir, exist_ok=True)
                    result["annotated"] = os.path.join(args.annotate_dir, f"c{n:03d}.jpg")
                    annotate(img, boxes, result["annotated"])
            except Exception as e:
                result["error"] = str(e)
            print(json.dumps(result, ensure_ascii=False), flush=True)
            continue
    for path in ([] if args.annotate_dir else args.files):
        result = {"file": os.path.basename(path), "faces": 0}
        try:
            img = read_image(path)
            if img is None:
                raise RuntimeError("사진을 읽지 못했습니다")
            boxes = detect_faces(detector, img, args.threshold)
            result["faces"] = len(boxes)
            if boxes and not args.detect_only:
                if args.backup:
                    os.makedirs(args.backup, exist_ok=True)
                    dst = os.path.join(args.backup, os.path.basename(path))
                    if not os.path.exists(dst):  # 처음 원본만 보관 (두 번 블러해도 원본은 그대로)
                        shutil.copy2(path, dst)
                write_image(path, blur_faces(img, boxes))
        except Exception as e:  # 한 장이 실패해도 나머지는 계속
            result["error"] = str(e)
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
