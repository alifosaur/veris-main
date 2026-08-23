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
            _pipe_cache = pipeline("image-classification", model="Organika/sdxl-detector")
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
        
        # Format: [{'label': 'generated', 'score': 0.98}, {'label': 'human', 'score': 0.02}]
        top_result = results[0]
        
        return {
            "label": "AI Generated" if top_result['label'] == 'generated' else "Human Created",
            "confidence": round(top_result['score'] * 100, 2)
        }
    except Exception as e:
        return {"label": "Analysis Failed", "confidence": 0, "error": str(e)}