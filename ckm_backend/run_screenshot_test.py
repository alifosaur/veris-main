import os
import sys
import asyncio
import io
import cv2
import numpy as np
from PIL import ImageGrab
from fastapi import UploadFile
from starlette.datastructures import Headers
import time

# Add ckm_backend directory to the python search path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import main
import advanced_watermark

# Mock the Gemini client to avoid hitting rate limits or requiring a valid key during tests
class MockEmbeddings:
    def __init__(self, values):
        self.values = values

class MockEmbeddingResult:
    def __init__(self, embeddings):
        self.embeddings = embeddings

class MockAioModels:
    async def embed_content(self, model, contents):
        # Return a mock vector of 3072 dimensions (required by gemini-embedding-2-preview)
        mock_vector = [0.1] * 3072
        return MockEmbeddingResult([MockEmbeddings(mock_vector)])

class MockAio:
    def __init__(self):
        self.models = MockAioModels()

class MockClient:
    def __init__(self):
        self.aio = MockAio()

main.client = MockClient()

async def run_tests():
    print("==============================================")
    print("  VERIS BACKEND SCREENSHOT & FP TEST SUITE    ")
    print("==============================================")
    
    # Clean the database collection
    try:
        existing_data = main.collection.get()
        all_ids = existing_data.get("ids", [])
        if all_ids:
            main.collection.delete(ids=all_ids)
            print(f"Cleaned {len(all_ids)} existing database records from vault.")
        else:
            print("Vault is empty. Clean slate verified.")
    except Exception as e:
        print("Warning: Could not clean database:", e)
        
    # --- TEST 1: REAL SCREENSHOT (NOT SIMULATED) ---
    print("\n==============================================")
    print("TEST 1: REAL SCREENSHOTS (2 DIFFERENT IMAGES)")
    print("==============================================")
    
    image_paths = ["photo_mountains.jpg", "photo_city.jpg"]
    
    for idx, path in enumerate(image_paths):
        print(f"\n--- Processing Image {idx+1}: {path} ---")
        if not os.path.exists(path):
            print(f"ERROR: Image '{path}' not found in the current directory.")
            print("Please make sure photo_mountains.jpg and photo_city.jpg are in the same folder.")
            continue
            
        with open(path, "rb") as f:
            original_bytes = f.read()
            
        # 1. Protect/Seal the image
        upload_file = UploadFile(filename=path, file=io.BytesIO(original_bytes))
        protect_response = await main.protect_asset(upload_file)
        dna = protect_response["new_dna"]
        download_url = protect_response["download_url"]
        
        # Decode the protected image bytes
        import base64
        header, base64_data = download_url.split(",", 1)
        protected_bytes = base64.b64decode(base64_data)
        
        protected_path = f"protected_{path.replace('.jpg', '.png')}"
        with open(protected_path, "wb") as f:
            f.write(protected_bytes)
            
        # 2. Open the sealed image in an OpenCV window on the screen
        print(f"Displaying {protected_path} on screen to capture screenshot...")
        protected_cv = cv2.imdecode(np.frombuffer(protected_bytes, np.uint8), cv2.IMREAD_UNCHANGED)
        
        # Resize to standard viewing size (e.g. 600x400) to simulate viewing it on a screen
        view_w, view_h = 600, 400
        view_img = cv2.resize(protected_cv, (view_w, view_h))
        
        window_name = f"VERIS Seal Test Window - Image {idx+1}"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, view_w, view_h)
        # Move window to a fixed position on screen (100, 100)
        cv2.moveWindow(window_name, 100, 100)
        cv2.imshow(window_name, view_img)
        
        # Wait a short duration for the window to render and process GUI events
        for _ in range(10):
            cv2.waitKey(100)
            
        # 3. Take an ACTUAL OS-level screen capture of the display bounding box
        # We grab the window area (from x=110 to x=690, y=140 to y=520) to capture ONLY the image content
        # avoiding OS borders.
        # This is a real capture of the screen pixels!
        bbox = (110, 140, 690, 520)
        print(f"Capturing screen region: {bbox}...")
        try:
            screenshot_pil = ImageGrab.grab(bbox)
            
            # Convert screenshot to PNG bytes
            screenshot_io = io.BytesIO()
            screenshot_pil.save(screenshot_io, format="PNG")
            screenshot_bytes = screenshot_io.getvalue()
            
            screenshot_path = f"screenshot_{path.replace('.jpg', '.png')}"
            with open(screenshot_path, "wb") as f:
                f.write(screenshot_bytes)
            print(f"Saved real screen-grab screenshot as '{screenshot_path}'")
            
            # 4. Scan the screenshot
            scan_file = UploadFile(
                filename=screenshot_path,
                file=io.BytesIO(screenshot_bytes),
                headers=Headers({"content-type": "image/png"})
            )
            scan_response = await main.scan_for_chori(scan_file)
            
            print("Scan Results:")
            print(" - Verified:", scan_response.get("verified"))
            print(" - Status:", scan_response.get("status"))
            print(" - Message:", scan_response.get("message"))
            print(" - Watermark Detected:", scan_response.get("watermark_detected"))
            
        except Exception as se:
            print("ERROR: Failed to capture screen programmatically.", se)
            print("This is normal if running in a headless or non-interactive background process.")
            
        # Close the window
        cv2.destroyWindow(window_name)
        
    # --- TEST 2: FALSE POSITIVE CHECK ---
    print("\n==============================================")
    print("TEST 2: FALSE POSITIVE & UNTOUCHED ASSET CHECKS")
    print("==============================================")
    
    # Part A: Scan a completely different, never-sealed image
    # We will use the original, untouched "photo_mountains.jpg" (which does not have any watermark)
    # and scan it. Since "photo_mountains" is registered in Chroma, its vector similarity might match
    # (since the mock vectors match), but its watermark check should fail!
    print("\n--- Part A: Scanning untouched original image of a registered asset (photo_mountains.jpg) ---")
    if os.path.exists("photo_mountains.jpg"):
        with open("photo_mountains.jpg", "rb") as f:
            untouched_bytes = f.read()
            
        scan_file = UploadFile(
            filename="photo_mountains.jpg",
            file=io.BytesIO(untouched_bytes),
            headers=Headers({"content-type": "image/jpeg"})
        )
        scan_response = await main.scan_for_chori(scan_file)
        print("Scan Results:")
        print(" - Verified:", scan_response.get("verified"))
        print(" - Status:", scan_response.get("status"))
        print(" - Message:", scan_response.get("message"))
        print(" - Watermark Detected:", scan_response.get("watermark_detected"))
    else:
        print("Error: photo_mountains.jpg not found for test.")
        
    # Part B: Scan a completely unrelated, untouched image that has no relation to the vault
    # We will generate a third image "photo_unrelated.png" and scan it without registering it first.
    print("\n--- Part B: Scanning completely unrelated, unregistered, untouched image ---")
    
    # We will temporarily mock the embedding of the unrelated image to return a totally DIFFERENT vector
    # so that it does NOT match by vector similarity.
    # This simulates scanning an unrelated image in the real-world vault.
    class MockDifferentAioModels:
        async def embed_content(self, model, contents):
            # Return a completely different vector of 3072 dimensions
            different_vector = [0.9] * 3072
            return MockEmbeddingResult([MockEmbeddings(different_vector)])

    main.client.aio.models = MockDifferentAioModels()
    
    # Generate a third synthetic image
    unrelated_img = np.ones((512, 512, 3), dtype=np.uint8) * 50 # dark image
    cv2.putText(unrelated_img, "UNRELATED", (100, 256), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 3)
    _, unrelated_bytes_png = cv2.imencode(".png", unrelated_img)
    unrelated_bytes = unrelated_bytes_png.tobytes()
    
    with open("photo_unrelated.png", "wb") as f:
        f.write(unrelated_bytes)
        
    scan_file = UploadFile(
        filename="photo_unrelated.png",
        file=io.BytesIO(unrelated_bytes),
        headers=Headers({"content-type": "image/png"})
    )
    scan_response = await main.scan_for_chori(scan_file)
    print("Scan Results:")
    print(" - Verified:", scan_response.get("verified"))
    print(" - Status:", scan_response.get("status"))
    print(" - Message:", scan_response.get("message"))
    print(" - Watermark Detected:", scan_response.get("watermark_detected"))
    
    # Clean up test output files
    for f in ["protected_photo_mountains.png", "screenshot_photo_mountains.png",
              "protected_photo_city.png", "screenshot_photo_city.png", "photo_unrelated.png"]:
        if os.path.exists(f):
            try:
                os.remove(f)
            except:
                pass

if __name__ == "__main__":
    asyncio.run(run_tests())
