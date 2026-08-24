import os
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
import chromadb
from dotenv import load_dotenv
from . import forensics
from . import advanced_watermark
import base64
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as pdf_canvas

# --- NAYE ENGINES KE IMPORTS ---
from . import metadata
from . import advanced_fingerprint

# 1. Load Secrets
load_dotenv()
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_KEY:
    raise ValueError("GEMINI_API_KEY is not set. Add it to your .env file or Render environment variables.")
print(f"Loaded GEMINI_API_KEY (first 10 chars): {GEMINI_KEY[:10]}...")

# Helper with basic exponential backoff retry for rate limits (no fake data fallbacks)
async def get_embeddings_with_retry(contents: bytes, mime_type: str, max_retries: int = 2) -> list:
    import asyncio
    backoff = 1.0  # start with 1 second delay
    for attempt in range(max_retries):
        try:
            result = await client.aio.models.embed_content(
                model="gemini-embedding-2-preview",
                contents=[types.Part.from_bytes(data=contents, mime_type=mime_type)]
            )
            return result.embeddings[0].values
        except Exception as e:
            err_msg = str(e)
            is_429 = "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg
            
            if is_429 and attempt < max_retries - 1:
                print(f"Gemini API rate limit (429) hit. Retrying in {backoff}s (attempt {attempt + 1}/{max_retries})...")
                await asyncio.sleep(backoff)
                backoff *= 2.0
            else:
                # Raise clean error when all retries are exhausted or other exceptions occur
                raise HTTPException(
                    status_code=503 if is_429 else 500,
                    detail=f"Verification service is temporarily unavailable: {err_msg}"
                )

# 2. Initialize FastAPI
app = FastAPI(title="AssetGuard Backend")

# Allow Frontend to talk to Backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Initialize AI & Database
# Fixed: API key is now properly passed as a string variable
client = genai.Client(api_key=GEMINI_KEY)
chroma_client = chromadb.PersistentClient(path="./ckm_db")
collection = chroma_client.get_or_create_collection(name="protected_assets")

@app.get("/")
def home():
    return {"message": "AssetGuard Backend is Live! Vault Active."}

# ==========================================
# /PROTECT ENDPOINT (NO CHANGES AT ALL)
# ==========================================
@app.post("/protect")
async def protect_asset(file: UploadFile = File(...), user_id: str = Form(None)):
    try:
        contents = await file.read()
        
        # --- 1. APPLY INVISIBLE WATERMARK ---
        import hashlib
        import datetime
        import secrets
        
        # Generate unique, secure DNA fingerprint
        sha256_hash = hashlib.sha256(contents).hexdigest()
        utc_timestamp_iso = datetime.datetime.utcnow().isoformat()
        random_8_char_suffix = secrets.token_hex(4)
        dna_string = f"VERIS-{sha256_hash[:32]}-{utc_timestamp_iso}-{random_8_char_suffix}"
        
        # Calculate original blue channel LL bias relative to green and red LL
        bias = advanced_watermark.calculate_channel_bias(contents)
        
        # Embed robust watermark
        watermarked_bytes = advanced_watermark.embed_watermark_dwt(contents, dna_string)
        
        # --- 2. GET GEMINI EMBEDDINGS (WITH RETRY AND BACKOFF) ---
        vector = await get_embeddings_with_retry(watermarked_bytes, "image/png")
        
        # --- 3. SAVE TO DATABASE ---
        # Storing with unique DNA string as ID to prevent filename-based collision overwrites
        collection.upsert(
            ids=[dna_string],
            embeddings=[vector],
            metadatas=[{
                "name": file.filename,
                "type": "watermarked",
                "status": "SAFE",
                "dna": dna_string,
                "bias": float(bias),
                "user_id": user_id or ""
            }]
        )
        
        # --- 4. PREPARE DOWNLOAD LINK (BASE64) ---
        base64_encoded = base64.b64encode(watermarked_bytes).decode('utf-8')
        download_uri = f"data:image/png;base64,{base64_encoded}"

        return {
            "status": "success",
            "message": f"Asset '{file.filename}' registered in the vault.",
            "new_dna": dna_string, 
            "download_url": download_uri 
        }
    except Exception as e:
        print(f"ERROR: BACKEND ERROR in /protect: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# /SCAN ENDPOINT (UPGRADED WITH FORENSICS & WATERMARK VERIFICATION)
# ==========================================
@app.post("/scan")
async def scan_for_chori(file: UploadFile = File(...), user_id: str = Form(None)):
    try:
        contents = await file.read()
        
        # --- THE 3 FORENSIC ENGINES ---
        meta_report = metadata.analyze(contents)                     # 1. EXIF
        hash_report = advanced_fingerprint.generate_hashes(contents) # 2. Perceptual Hashes
        forensic_report = forensics.analyze_forensics(contents)      # 3. ELA & Noise
        
        # --- GEMINI VAULT CHECK (WITH RETRY AND BACKOFF) ---
        query_vector = await get_embeddings_with_retry(contents, file.content_type)
        
        search_results = collection.query(
            query_embeddings=[query_vector],
            n_results=1
        )
        
        is_flagged_stolen = False
        is_own_asset = False
        match_message = "No matches found. Asset is clean."
        watermark_detected = False
        vector_match = False
        match_type = "none"
        confidence = 0.0
        stored_user_id = ""
        candidate_dna = ""
        
        if search_results['distances'] and search_results['distances'][0]:
            distance = search_results['distances'][0][0]
            # Vector match check (using 0.25 L2 distance threshold)
            if distance < 0.25:
                vector_match = True
                confidence = float(max(0.0, min(1.0, 1.0 - distance / 2.0)) * 100.0)
            
            # Watermark match check on the nearest neighbor
            if search_results['metadatas'] and search_results['metadatas'][0]:
                meta = search_results['metadatas'][0][0]
                if meta and isinstance(meta, dict):
                    candidate_dna = meta.get("dna", "")
                    candidate_bias = meta.get("bias", 0.0)
                    stored_user_id = meta.get("user_id", "")
                    if candidate_dna:
                        # Verify the watermark using the matched candidate's DNA and stored channel bias
                        watermark_detected = advanced_watermark.verify_watermark_match(
                            contents,
                            candidate_dna,
                            bias=candidate_bias
                        )
                        
        if vector_match:
            # Check ownership
            if user_id and stored_user_id and user_id == stored_user_id:
                is_own_asset = True
                match_type = "verified" if watermark_detected else "likely"
                if watermark_detected:
                    match_message = "This is your sealed, protected copy — watermark verified."
                else:
                    match_message = "This content matches your registered asset, but this specific file does not carry the VERIS watermark (likely an unsealed original or a copy from before sealing)."
                status_text = "✅ YOUR PROTECTED ASSET"
            else:
                is_flagged_stolen = True
                status_text = "🚨 CHORI DETECTED!"
                if watermark_detected:
                    match_type = "verified"
                    match_message = f"Verified match! Visual similarity: {confidence:.2f}% & watermark signature verified."
                else:
                    match_type = "likely"
                    match_message = f"Content match found (visual similarity: {confidence:.2f}%) — original watermark not detected, likely due to screenshot/recompression."
        else:
            # If vector doesn't match but watermark is detected (anomaly/heavy editing)
            if watermark_detected:
                if user_id and stored_user_id and user_id == stored_user_id:
                    is_own_asset = True
                    match_type = "likely"
                    match_message = "This is your sealed, protected copy — watermark verified."
                    status_text = "✅ YOUR PROTECTED ASSET"
                else:
                    is_flagged_stolen = True
                    match_type = "likely"
                    match_message = "Watermark signature detected, but visual content is modified."
                    status_text = "🚨 CHORI DETECTED!"
            else:
                match_type = "none"
                match_message = "No matches found. Asset is clean."
                status_text = "✅ CLEAN"

        # --- CALCULATE AUTHENTICITY SCORE ---
        authenticity_score = 100
        if meta_report.get("is_suspicous"): authenticity_score -= 15
        if forensic_report.get("risk") == "High": authenticity_score -= 20
        if is_flagged_stolen: authenticity_score = 0

        # UI Payload
        return {
            "is_flagged_stolen": is_flagged_stolen,
            "is_own_asset": is_own_asset,
            "authenticity_score": max(0, authenticity_score),
            "message": match_message,
            "status": status_text,
            "watermark_detected": watermark_detected,
            "match_type": match_type,
            "vector_match": vector_match,
            "confidence": confidence,
            "dna": candidate_dna,
            "forensics": {
                "metadata": meta_report,
                "hashes": hash_report,
                "image_analysis": forensic_report
            }
        }

    except Exception as e:
        print(f"ERROR: BACKEND ERROR in /scan: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# /PROTECT-BULK ENDPOINT (NEW)
# ==========================================
@app.post("/protect-bulk")
async def protect_bulk(files: list[UploadFile] = File(...), user_id: str = Form(None)):
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="Max 10 files per bulk request.")
        
    results = []
    import asyncio
    import time
    import hashlib
    import datetime
    import secrets
    
    for idx, file in enumerate(files):
        # If not the first file, introduce a delay of 4 seconds to respect 15 RPM free tier limits
        if idx > 0:
            await asyncio.sleep(4.0)
            
        try:
            contents = await file.read()
            if not contents:
                raise ValueError("Empty file uploaded.")
                
            # --- 1. APPLY INVISIBLE WATERMARK ---
            sha256_hash = hashlib.sha256(contents).hexdigest()
            utc_timestamp_iso = datetime.datetime.utcnow().isoformat()
            random_8_char_suffix = secrets.token_hex(4)
            dna_string = f"VERIS-{sha256_hash[:32]}-{utc_timestamp_iso}-{random_8_char_suffix}"
            
            # Calculate original blue channel LL bias relative to green and red LL
            bias = advanced_watermark.calculate_channel_bias(contents)
            
            # Embed robust watermark
            watermarked_bytes = advanced_watermark.embed_watermark_dwt(contents, dna_string)
            
            # --- 2. GET GEMINI EMBEDDINGS (WITH RETRY AND BACKOFF) ---
            vector = await get_embeddings_with_retry(watermarked_bytes, "image/png")
            
            # --- 3. SAVE TO DATABASE ---
            collection.upsert(
                ids=[dna_string],
                embeddings=[vector],
                metadatas=[{
                    "name": file.filename,
                    "type": "watermarked",
                    "status": "SAFE",
                    "dna": dna_string,
                    "bias": float(bias),
                    "user_id": user_id or ""
                }]
            )
            
            # Convert watermarked bytes to base64 download url (inline data URI)
            b64 = base64.b64encode(watermarked_bytes).decode()
            download_uri = f"data:image/png;base64,{b64}"
            
            results.append({
                "fileName": file.filename,
                "status": "success",
                "new_dna": dna_string,
                "download_url": download_uri
            })
            
        except Exception as e:
            print(f"ERROR: Bulk protection failed for file '{file.filename}': {e}")
            results.append({
                "fileName": file.filename,
                "status": "error",
                "message": str(e)
            })
            
    return {"results": results}

# ==========================================
# /GENERATE-DMCA ENDPOINT (NEW)
# ==========================================
@app.post("/generate-dmca")
async def generate_dmca(
    owner_name: str = Form(...),
    owner_email: str = Form(...),
    infringing_url: str = Form(...),
    dna_string: str = Form(...)
):
    try:
        # 1. Lookup the dna_string in Chroma DB
        entry = collection.get(ids=[dna_string])
        if not entry or not entry.get("ids") or len(entry["ids"]) == 0:
            raise HTTPException(
                status_code=404, 
                detail="Asset not found in database vault. Cannot generate DMCA notice for unregistered assets."
            )
            
        # Extract metadata
        meta = entry["metadatas"][0]
        file_name = meta.get("name", "Unknown File")
        
        # Parse timestamp from DNA string
        try:
            seal_timestamp = dna_string[39:-9]
        except Exception:
            seal_timestamp = datetime.datetime.utcnow().isoformat()
            
        # 2. Generate PDF using reportlab
        import io
        import base64
        import datetime
        
        buffer = io.BytesIO()
        c = pdf_canvas.Canvas(buffer, pagesize=A4)
        width, height = A4
        
        # Header (Cyber/Cyan Banner)
        c.setFillColorRGB(0.07, 0.91, 0.91)
        c.rect(0, height - 80, width, 80, fill=True, stroke=False)
        c.setFillColorRGB(0.05, 0.05, 0.1)
        c.setFont("Helvetica-Bold", 20)
        c.drawString(40, height - 48, "VERIS — DMCA TAKEDOWN NOTICE")
        
        # Document Content
        c.setFillColorRGB(0.1, 0.1, 0.1)
        c.setFont("Helvetica", 11)
        y = height - 120
        
        current_date_str = datetime.datetime.utcnow().strftime('%B %d, %Y')
        
        lines = [
            f"Date of Notice: {current_date_str}",
            "",
            f"Rights Holder: {owner_name}",
            f"Contact Email: {owner_email}",
            "",
            "IDENTIFICATION OF COPYRIGHTED WORK:",
            f"  Original Filename: {file_name}",
            f"  VERIS DNA Fingerprint: {dna_string}",
            f"  Original Registration Date: {seal_timestamp}",
            "",
            "LOCATION OF INFRINGING MATERIAL:",
            f"  Infringing URL: {infringing_url}",
            "",
            "STATEMENT OF GOOD FAITH:",
            "  I have a good faith belief that use of the copyrighted material",
            "  described above is not authorized by the copyright owner, its",
            "  agent, or the law.",
            "",
            "STATEMENT OF ACCURACY:",
            "  The information in this notification is accurate and I am the",
            "  copyright owner or authorized to act on behalf of the owner.",
            "",
            "Digital Signature:",
            f"  /s/ {owner_name}",
            f"  Signed on: {current_date_str}"
        ]
        
        for line in lines:
            c.drawString(40, y, line)
            y -= 18
            if y < 60:
                c.showPage()
                y = height - 60
                
        c.save()
        buffer.seek(0)
        pdf_b64 = base64.b64encode(buffer.read()).decode()
        
        return {
            "status": "success",
            "pdf": f"data:application/pdf;base64,{pdf_b64}",
            "download_url": f"data:application/pdf;base64,{pdf_b64}",
            "filename": f"VERIS_DMCA_{datetime.datetime.utcnow().strftime('%Y%m%d')}.pdf"
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"ERROR: Generate DMCA error: {e}")
        raise HTTPException(status_code=500, detail=str(e))