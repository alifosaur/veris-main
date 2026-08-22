"""
main.py — VERIS Backend
Run with: uvicorn main:app --reload --port 8000

Install deps:
pip install fastapi uvicorn pillow numpy python-multipart reportlab requests
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import numpy as np
from PIL import Image
import hashlib
import io
import base64
import json
import datetime
import os
import requests
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as pdf_canvas

app = FastAPI(title="VERIS API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, set to your domain
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── In-memory DNA vault (replace with Firestore in production) ───
dna_vault: dict[str, dict] = {}


# ─────────────────────────────────────────────────────────────────
#  UTILITY: Invisible Watermark (LSB steganography)
# ─────────────────────────────────────────────────────────────────

def inject_watermark(img: Image.Image, dna: str) -> Image.Image:
    """
    Injects DNA string invisibly into the image using LSB steganography.
    Modifies only the least significant bit of the red channel —
    completely invisible to the human eye.
    """
    arr = np.array(img.convert("RGB"), dtype=np.uint8)
    binary_dna = "".join(format(ord(c), "08b") for c in dna) + "1111111111111110"  # EOF marker

    flat = arr[:, :, 0].flatten()  # Red channel
    if len(binary_dna) > len(flat):
        raise ValueError("Image too small to hold watermark")

    for i, bit in enumerate(binary_dna):
        flat[i] = (flat[i] & 0xFE) | int(bit)  # Set LSB

    arr[:, :, 0] = flat.reshape(arr[:, :, 0].shape)
    return Image.fromarray(arr)


def extract_watermark(img: Image.Image) -> str:
    """
    Extracts the hidden DNA string from the image LSBs.
    Returns empty string if no watermark found.
    """
    arr = np.array(img.convert("RGB"), dtype=np.uint8)
    flat = arr[:, :, 0].flatten()
    bits = [str(px & 1) for px in flat]

    chars = []
    for i in range(0, len(bits) - 8, 8):
        byte = "".join(bits[i:i+8])
        if byte == "11111111":
            # Check for EOF marker
            next_byte = "".join(bits[i+8:i+16])
            if next_byte == "11111110":
                break
        chars.append(chr(int(byte, 2)))

    return "".join(chars)


def compute_sha256(img_bytes: bytes) -> str:
    return hashlib.sha256(img_bytes).hexdigest()


def image_to_base64(img: Image.Image) -> str:
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    b64 = base64.b64encode(buffer.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


# ─────────────────────────────────────────────────────────────────
#  ROUTE 1: Protect / Seal Image
# ─────────────────────────────────────────────────────────────────

@app.post("/protect")
async def protect_image(file: UploadFile = File(...)):
    """
    - Reads uploaded image
    - Generates a unique DNA hash (SHA-256 of original bytes + timestamp)
    - Injects it invisibly using LSB steganography
    - Returns the watermarked image as base64 + DNA string
    """
    contents = await file.read()
    img = Image.open(io.BytesIO(contents))

    timestamp = datetime.datetime.utcnow().isoformat()
    raw_hash = compute_sha256(contents)
    dna = f"VERIS-{raw_hash[:32]}-{timestamp}"

    try:
        watermarked = inject_watermark(img, dna)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Save DNA to local vault (Firestore handles persistent storage via frontend)
    dna_vault[raw_hash[:16]] = {
        "dna": dna,
        "filename": file.filename,
        "timestamp": timestamp,
    }

    return {
        "status": "success",
        "new_dna": dna,
        "original_hash": raw_hash,
        "download_url": image_to_base64(watermarked),
        "timestamp": timestamp,
    }


# ─────────────────────────────────────────────────────────────────
#  ROUTE 2: Scan / Verify Image
# ─────────────────────────────────────────────────────────────────

@app.post("/scan")
async def scan_image(file: UploadFile = File(...)):
    """
    - Reads uploaded image
    - Extracts hidden watermark from LSBs
    - If watermark starts with VERIS-, it's authenticated
    """
    contents = await file.read()
    img = Image.open(io.BytesIO(contents))

    extracted = extract_watermark(img)

    if extracted.startswith("VERIS-"):
        return {
            "status": "✅ CLEAN",
            "message": f"Authentic VERIS watermark found.",
            "extracted_dna": extracted,
            "verified": True,
        }
    else:
        return {
            "status": "❌ UNAUTHORIZED",
            "message": "No valid VERIS watermark detected. This asset may be tampered or unregistered.",
            "extracted_dna": None,
            "verified": False,
        }


# ─────────────────────────────────────────────────────────────────
#  ROUTE 3: NEW — Generate DMCA Takedown Report PDF
# ─────────────────────────────────────────────────────────────────

@app.post("/generate-dmca")
async def generate_dmca(data: dict):
    """
    Body: {
      "ownerName": str,
      "ownerEmail": str,
      "fileName": str,
      "dna": str,
      "sealTimestamp": str,
      "infringingUrl": str
    }
    Returns a downloadable PDF base64 string.
    """
    buffer = io.BytesIO()
    c = pdf_canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    # Header
    c.setFillColorRGB(0.07, 0.91, 0.91)
    c.rect(0, height - 80, width, 80, fill=True, stroke=False)
    c.setFillColorRGB(0, 0, 0.1)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(40, height - 50, "VERIS — DMCA Takedown Notice")

    # Body
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.setFont("Helvetica", 11)
    y = height - 120

    lines = [
        f"Date: {datetime.datetime.utcnow().strftime('%B %d, %Y')}",
        "",
        f"Rights Holder: {data.get('ownerName', 'N/A')}",
        f"Contact Email: {data.get('ownerEmail', 'N/A')}",
        "",
        "IDENTIFICATION OF COPYRIGHTED WORK:",
        f"  File: {data.get('fileName', 'N/A')}",
        f"  VERIS DNA Fingerprint: {data.get('dna', 'N/A')}",
        f"  Original Seal Timestamp: {data.get('sealTimestamp', 'N/A')}",
        "",
        "LOCATION OF INFRINGING MATERIAL:",
        f"  URL: {data.get('infringingUrl', 'N/A')}",
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
        f"Signed: {data.get('ownerName', 'N/A')}",
        f"Date: {datetime.datetime.utcnow().strftime('%B %d, %Y')}",
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
        "filename": f"VERIS_DMCA_{datetime.datetime.utcnow().strftime('%Y%m%d')}.pdf",
    }


# ─────────────────────────────────────────────────────────────────
#  ROUTE 4: NEW — Bulk Seal (multiple images)
# ─────────────────────────────────────────────────────────────────

@app.post("/protect-bulk")
async def protect_bulk(files: list[UploadFile] = File(...)):
    """
    Accepts up to 10 images, seals all of them, returns array of results.
    """
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="Max 10 files per bulk request.")

    results = []
    for file in files:
        contents = await file.read()
        img = Image.open(io.BytesIO(contents))
        timestamp = datetime.datetime.utcnow().isoformat()
        raw_hash = compute_sha256(contents)
        dna = f"VERIS-{raw_hash[:32]}-{timestamp}"
        try:
            watermarked = inject_watermark(img, dna)
            results.append({
                "fileName": file.filename,
                "status": "success",
                "new_dna": dna,
                "download_url": image_to_base64(watermarked),
            })
        except ValueError as e:
            results.append({"fileName": file.filename, "status": "error", "message": str(e)})

    return {"results": results}


# ─────────────────────────────────────────────────────────────────
#  Health Check
# ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "online", "version": "2.0.0", "vault_size": len(dna_vault)}