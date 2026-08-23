from PIL import Image
import io

# Module-level variable for lazy load caching
_pipe_cache = None

def get_pipe():
    """
    Lazily loads and caches the Swin Transformer pipeline.
    This prevents server startup from blocking or crashing if model download is slow or memory is tight.
    """
    global _pipe_cache
    if _pipe_cache is None:
        print("Loading AI Detection Model (Swin Transformer) lazily...")
        try:
            from transformers import pipeline
            _pipe_cache = pipeline("image-classification", model="ongtrandong2/ai_vs_real_image_detection")
        except Exception as e:
            print(f"Warning: Could not load HuggingFace model. Error: {e}")
            _pipe_cache = None
    return _pipe_cache

def detect_ai(image_bytes: bytes):
    pipe = get_pipe()
    if not pipe:
        return {"label": "System Offline", "confidence": 0}
        
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        results = pipe(img)
        
        # Format: [{'label': 'FAKE', 'score': 0.90}, {'label': 'REAL', 'score': 0.10}]
        top_result = results[0]
        
        return {
            "label": "AI Generated" if top_result['label'] == 'FAKE' else "Human Created",
            "confidence": round(top_result['score'] * 100, 2)
        }
    except Exception as e:
        return {"label": "Analysis Failed", "confidence": 0, "error": str(e)}