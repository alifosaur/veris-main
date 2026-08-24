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
        from reportlab.lib.pagesizes import A4
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib import colors
        from reportlab.graphics.shapes import Drawing, Circle, Line
        from reportlab.pdfgen import canvas as pdf_canvas

        class NumberedCanvas(pdf_canvas.Canvas):
            def __init__(self, *args, owner_name=None, owner_email=None, doc_ref=None, current_date_str=None, **kwargs):
                super().__init__(*args, **kwargs)
                self.owner_name = owner_name or "Test Owner"
                self.owner_email = owner_email or "owner@test.com"
                self.doc_ref = doc_ref or "2026-VRS-8901"
                self.current_date_str = current_date_str or "August 24, 2026"
                self._saved_page_states = []

            def showPage(self):
                self._saved_page_states.append(dict(self.__dict__))
                self._startPage()

            def save(self):
                num_pages = len(self._saved_page_states)
                for state in self._saved_page_states:
                    self.__dict__.update(state)
                    self.draw_page_decorations(num_pages)
                    super().showPage()
                super().save()

            def draw_page_decorations(self, total_pages):
                self.setFont("Helvetica", 7)
                self.setFillColor(colors.HexColor('#526174'))
                
                # Left footer (2 lines)
                self.drawString(40, 50, "VERIS™ SECURE IP")
                self.drawString(40, 42, "ENFORCEMENT")
                
                # Center footer (2 lines)
                self.drawCentredString(297.6, 50, "CONFIDENTIAL — COPYRIGHT ENFORCEMENT")
                self.drawCentredString(297.6, 42, "DOCUMENTATION")
                
                # Right footer (1 line)
                self.drawRightString(555, 45, f"PAGE {self._pageNumber} OF {total_pages}")
                
                if self._pageNumber == 1:
                    # Letterhead left
                    self.setFont("Helvetica-Bold", 22)
                    self.setFillColor(colors.HexColor('#07152F'))
                    self.drawString(40, 770, "V E R I S")
                    
                    self.setFont("Helvetica-Bold", 7)
                    self.setFillColor(colors.HexColor('#526174'))
                    self.drawString(40, 755, "DIGITAL CONTENT PROTECTION & V E R I F I C AT I O N")
                    
                    # Title right
                    self.setFont("Helvetica-Bold", 10)
                    self.setFillColor(colors.HexColor('#07152F'))
                    self.drawRightString(555, 770, "DMCA COPYRIGHT INFRINGEMENT NOTICE")
                    
                    self.setFont("Helvetica", 8)
                    self.setFillColor(colors.HexColor('#526174'))
                    self.drawRightString(555, 755, f"DOCUMENT REF: {self.doc_ref}")
                    
                    # Divider
                    self.setStrokeColor(colors.HexColor('#D7E6ED'))
                    self.setLineWidth(0.5)
                    self.line(40, 745, 555, 745)
                    
                    # Metadata block
                    # date
                    self.setFont("Helvetica-Bold", 8)
                    self.setFillColor(colors.HexColor('#526174'))
                    self.drawString(40, 725, "DATE:")
                    self.setFont("Helvetica", 8.5)
                    self.setFillColor(colors.HexColor('#07152F'))
                    self.drawString(140, 725, self.current_date_str)
                    
                    # Case ID
                    self.setFont("Helvetica-Bold", 8)
                    self.setFillColor(colors.HexColor('#526174'))
                    self.drawString(40, 705, "NOTICE / CASE ID:")
                    self.setFont("Helvetica", 8.5)
                    self.setFillColor(colors.HexColor('#07152F'))
                    self.drawString(140, 705, self.doc_ref)
                    
                    # Subject
                    self.setFont("Helvetica-Bold", 8)
                    self.setFillColor(colors.HexColor('#526174'))
                    self.drawString(40, 685, "SUBJECT:")
                    self.setFont("Helvetica-Bold", 8.5)
                    self.setFillColor(colors.HexColor('#07152F'))
                    self.drawString(140, 685, "Formal Notification of Copyright Infringement")
                    
                    # Right column
                    self.setFont("Helvetica-Bold", 8)
                    self.setFillColor(colors.HexColor('#526174'))
                    self.drawString(300, 725, "RIGHTS HOLDER:")
                    self.setFont("Helvetica", 8.5)
                    self.setFillColor(colors.HexColor('#07152F'))
                    self.drawString(400, 725, self.owner_name)
                    
                    # Contact
                    self.setFont("Helvetica-Bold", 8)
                    self.setFillColor(colors.HexColor('#526174'))
                    self.drawString(300, 705, "CONTACT:")
                    self.setFont("Helvetica", 8.5)
                    self.setFillColor(colors.HexColor('#07152F'))
                    self.drawString(400, 705, self.owner_email)
                    
                    # Center title
                    self.setFont("Helvetica-Bold", 14)
                    self.setFillColor(colors.HexColor('#07152F'))
                    self.drawCentredString(297.6, 640, "NOTICE OF COPYRIGHT INFRINGEMENT")

        def make_section_header(title_text, section_header_style):
            t = Table([[Paragraph(title_text, section_header_style)]], colWidths=[515])
            t.setStyle(TableStyle([
                ('LINEBELOW', (0,0), (-1,-1), 0.5, colors.HexColor('#D7E6ED')),
                ('BOTTOMPADDING', (0,0), (-1,-1), 4),
                ('TOPPADDING', (0,0), (-1,-1), 12),
                ('LEFTPADDING', (0,0), (-1,-1), 0),
                ('RIGHTPADDING', (0,0), (-1,-1), 0),
            ]))
            return t

        def make_key_value_table(rows_data, label_style, value_style):
            table_data = []
            for label, val in rows_data:
                if isinstance(val, str):
                    val_p = Paragraph(val, value_style)
                else:
                    val_p = val
                table_data.append([
                    Paragraph(label, label_style),
                    val_p
                ])
            t = Table(table_data, colWidths=[150, 365])
            t.setStyle(TableStyle([
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('BOTTOMPADDING', (0,0), (-1,-1), 6),
                ('TOPPADDING', (0,0), (-1,-1), 6),
                ('LEFTPADDING', (0,0), (-1,-1), 0),
                ('RIGHTPADDING', (0,0), (-1,-1), 0),
            ]))
            return t

        def make_fingerprint_box(dna, fingerprint_title_style, fingerprint_dna_style, fingerprint_caption_style):
            d = Drawing(40, 40)
            d.add(Circle(20, 20, 16, strokeColor=colors.HexColor('#2563EB'), strokeWidth=1.2, fillColor=None))
            d.add(Line(20, 4, 20, 8, strokeColor=colors.HexColor('#2563EB'), strokeWidth=1))
            d.add(Line(20, 32, 20, 36, strokeColor=colors.HexColor('#2563EB'), strokeWidth=1))
            d.add(Line(4, 20, 8, 20, strokeColor=colors.HexColor('#2563EB'), strokeWidth=1))
            d.add(Line(32, 20, 36, 20, strokeColor=colors.HexColor('#2563EB'), strokeWidth=1))
            d.add(Line(20, 20, 20, 30, strokeColor=colors.HexColor('#2563EB'), strokeWidth=1.2))
            d.add(Line(20, 20, 27, 16, strokeColor=colors.HexColor('#2563EB'), strokeWidth=1.2))
            
            dna_para = Paragraph(f"<font color='#07152F'>{dna}</font>", fingerprint_dna_style)
            
            text_content = [
                Paragraph("VERIS CRYPTOGRAPHIC CONTENT FINGERPRINT", fingerprint_title_style),
                Spacer(1, 4),
                dna_para,
                Spacer(1, 4),
                Paragraph("VERIFIED EVIDENCE FRAGMENT · AUTOGENERATED · DO NOT ALTER", fingerprint_caption_style)
            ]
            
            box_table = Table([[d, text_content]], colWidths=[50, 445])
            box_table.setStyle(TableStyle([
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
                ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#D7E6ED')),
                ('PADDING', (0,0), (-1,-1), 10),
                ('LEFTPADDING', (0,0), (-1,-1), 12),
                ('RIGHTPADDING', (0,0), (-1,-1), 12),
            ]))
            return box_table

        buffer = io.BytesIO()
        current_date_str = datetime.datetime.utcnow().strftime('%B %d, %Y')
        doc_ref = f"{datetime.datetime.utcnow().year}-VRS-{dna_string[-4:].upper()}"
        
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=40,
            rightMargin=40,
            topMargin=40,
            bottomMargin=80
        )
        
        styles = getSampleStyleSheet()
        
        body_style = ParagraphStyle(
            'DMCA_Body',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=9.5,
            leading=14.5,
            textColor=colors.HexColor('#07152F'),
            spaceAfter=15
        )
        
        section_header_style = ParagraphStyle(
            'DMCA_SectionHeader',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=9,
            leading=11,
            textColor=colors.HexColor('#2563EB'),
            spaceBefore=15,
            spaceAfter=5
        )
        
        label_style = ParagraphStyle(
            'DMCA_Label',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=8,
            leading=11,
            textColor=colors.HexColor('#526174')
        )
        
        value_style = ParagraphStyle(
            'DMCA_Value',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=9,
            leading=12,
            textColor=colors.HexColor('#07152F')
        )
        
        value_bold_style = ParagraphStyle(
            'DMCA_ValueBold',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=9,
            leading=12,
            textColor=colors.HexColor('#07152F')
        )
        
        fingerprint_title_style = ParagraphStyle(
            'DMCA_FP_Title',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=7.5,
            leading=10,
            textColor=colors.HexColor('#2563EB')
        )
        
        fingerprint_dna_style = ParagraphStyle(
            'DMCA_FP_DNA',
            parent=styles['Normal'],
            fontName='Courier-Bold',
            fontSize=9,
            leading=12,
            textColor=colors.HexColor('#07152F')
        )
        
        fingerprint_caption_style = ParagraphStyle(
            'DMCA_FP_Caption',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=6.5,
            leading=8,
            textColor=colors.HexColor('#94A3B8')
        )
        
        story = []
        
        # 1. Spacer to clear first page header
        story.append(Spacer(1, 230))
        
        # 2. Intro paragraph
        intro_text = (
            "This document serves as an official notification pursuant to the Digital Millennium Copyright Act "
            "(17 U.S.C. § 512) and applicable international intellectual property laws. We are writing to notify you "
            "that your service is hosting, transmitting, or otherwise providing access to material that infringes "
            "upon the exclusive copyrights of the entity identified below."
        )
        story.append(Paragraph(intro_text, body_style))
        
        # 3. Section 1
        story.append(make_section_header("1. IDENTIFICATION OF COPYRIGHT OWNER", section_header_style))
        story.append(Spacer(1, 6))
        owner_rows = [
            ("RIGHTS HOLDER NAME:", owner_name),
            ("ORGANIZATION:", "AssetGuard Solutions"),
            ("CONTACT EMAIL:", owner_email),
            ("AUTHORITY:", "Authorized Representative / Original Creator")
        ]
        story.append(make_key_value_table(owner_rows, label_style, value_style))
        
        # 4. Section 2
        story.append(make_section_header("2. IDENTIFICATION OF COPYRIGHTED WORK", section_header_style))
        story.append(Spacer(1, 6))
        story.append(Paragraph("The following original, copyrighted work is the subject of this infringement notice:", body_style))
        
        work_title_p = Paragraph(f"<b>AssetGuard Protected Image: {file_name}</b>", value_bold_style)
        work_rows = [
            ("TITLE / DESCRIPTION:", work_title_p),
            ("ORIGINAL WORK URL:", f"https://veris-main.onrender.com/vault/{dna_string}"),
            ("REGISTRATION REF:", f"USCO-2026-VRS-{dna_string[-8:].upper()}")
        ]
        story.append(make_key_value_table(work_rows, label_style, value_style))
        story.append(Spacer(1, 10))
        story.append(make_fingerprint_box(dna_string, fingerprint_title_style, fingerprint_dna_style, fingerprint_caption_style))
        
        # 5. Page Break (Section 3 starts on page 2)
        story.append(PageBreak())
        
        # 6. Section 3
        story.append(make_section_header("3. IDENTIFICATION OF INFRINGING MATERIAL", section_header_style))
        story.append(Spacer(1, 6))
        story.append(Paragraph("The material identified below infringes upon the copyrighted work described in Section 2 and must be expeditiously removed or access to it disabled:", body_style))
        
        infringing_rows = [
            ("INFRINGING URL(S):", infringing_url),
            ("INFRINGEMENT DETAILS:", "Unauthorized duplication, hosting, and public distribution of the copyrighted image asset."),
            ("DATE DETECTED:", current_date_str)
        ]
        story.append(make_key_value_table(infringing_rows, label_style, value_style))
        
        # 7. Section 4
        story.append(make_section_header("4. GOOD-FAITH STATEMENT", section_header_style))
        story.append(Spacer(1, 6))
        story.append(Paragraph("I have a good faith belief that the use of the copyrighted materials described above as allegedly infringing is not authorized by the copyright owner, its agent, or the law.", body_style))
        
        # 8. Section 5
        story.append(make_section_header("5. STATEMENT OF ACCURACY AND AUTHORITY", section_header_style))
        story.append(Spacer(1, 6))
        story.append(Paragraph("I swear, under penalty of perjury, that the information in this notification is accurate and that I am the copyright owner or am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.", body_style))
        
        # 9. Section 6
        story.append(make_section_header("6. REQUEST FOR EXPEDITIOUS REMOVAL", section_header_style))
        story.append(Spacer(1, 6))
        story.append(Paragraph("In light of the foregoing, we request that you immediately and expeditiously remove or disable access to the infringing material identified in Section 3, and notify us when this action has been completed. Please preserve all records associated with the infringing material for potential future legal proceedings.", body_style))
        
        story.append(Spacer(1, 15))
        story.append(Paragraph("Respectfully submitted,", body_style))
        story.append(Spacer(1, 15))
        
        # 10. Signature block (Keep Together)
        sig_line = Table([[Paragraph("", body_style)]], colWidths=[200], rowHeights=[1], style=TableStyle([
            ('LINEBELOW', (0,0), (-1,-1), 0.5, colors.HexColor('#000000')),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 0),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ]))
        
        sig_elements = [
            sig_line,
            Spacer(1, 6),
            Paragraph(f"<b>{owner_name}</b>", value_bold_style),
            Paragraph("Authorized Representative", value_style),
            Paragraph("AssetGuard Solutions · Secured by VERIS", value_style),
            Paragraph(owner_email, value_style)
        ]
        story.append(KeepTogether(sig_elements))
        
        # Build Document using NumberedCanvas
        doc.build(
            story,
            canvasmaker=lambda *args, **kwargs: NumberedCanvas(
                *args,
                owner_name=owner_name,
                owner_email=owner_email,
                doc_ref=doc_ref,
                current_date_str=current_date_str,
                **kwargs
            )
        )
        
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