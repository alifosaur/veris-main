import cv2
import numpy as np
from PIL import Image, ImageChops, ImageEnhance
import io

def analyze_forensics(image_bytes: bytes):
    try:
        # Convert bytes to OpenCV format
        nparr = np.frombuffer(image_bytes, np.uint8)
        img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        report = {}
        
        # 1. Noise Pattern Analysis (Laplacian Variance)
        # Low variance means it might be a blur/AI smoothed, very high means added noise
        gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        report['noise_variance'] = round(laplacian_var, 2)
        report['noise_status'] = "Normal" if laplacian_var > 100 else "Suspiciously Smooth (Possible AI/Blur)"

        # 2. Error Level Analysis (ELA) - Fast Approximation
        # Re-save the image at known quality and find the difference
        pil_img = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        resaved_io = io.BytesIO()
        pil_img.save(resaved_io, 'JPEG', quality=90)
        resaved_io.seek(0)
        resaved_img = Image.open(resaved_io)
        
        ela_diff = ImageChops.difference(pil_img, resaved_img)
        extrema = ela_diff.getextrema()
        max_diff = max([ex[1] for ex in extrema])
        
        if max_diff > 50:
            report['ela_status'] = "High Compression Anomalies (Likely Edited)"
            report['risk'] = "High"
        else:
            report['ela_status'] = "Uniform Compression (Clean)"
            report['risk'] = "Low"

        return report
    except Exception as e:
        return {"error": str(e), "ela_status": "Analysis Failed", "risk": "Unknown"}