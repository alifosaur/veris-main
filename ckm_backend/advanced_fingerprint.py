import imagehash
from PIL import Image
import io
import hashlib

def generate_hashes(image_bytes: bytes):
    try:
        img = Image.open(io.BytesIO(image_bytes))
        
        return {
            "sha256": hashlib.sha256(image_bytes).hexdigest(),
            "phash": str(imagehash.phash(img)), # Perceptual hash (survives compression)
            "dhash": str(imagehash.dhash(img)), # Difference hash (survives resizing)
            "whash": str(imagehash.whash(img))  # Wavelet hash (survives color shifts)
        }
    except Exception as e:
        return {"error": str(e)}