# VERIS

### Digital Content Protection & Ownership Verification

**VERIS** is a full-stack project exploring how digital creators can protect and verify their visual content.

It combines **invisible watermarking, visual fingerprinting, image forensics, similarity search, and DMCA document generation** into a single workflow.

> **Protect → Register → Scan → Verify**

---

## Why VERIS?

Digital images can be copied, modified, compressed, or stripped of their metadata, making it difficult to identify an original work.

VERIS explores a simple idea:

> **What if an image could carry its own evidence?**

The project creates multiple signals around a registered image — from invisible watermarks to visual fingerprints — and uses them together when checking a potentially copied asset.

---

## How It Works

```text
Original Image
      │
      ▼
   PROTECT
      │
      ├── Invisible Watermark
      └── Visual Fingerprint
              │
              ▼
          REGISTER
              │
              ▼
            SCAN
              │
              ├── Similarity Check
              ├── Watermark Check
              └── Forensic Analysis
                      │
                      ▼
                   VERIFY
                      │
                      ▼
              DMCA Documentation
```

---

## Features

* **Invisible Watermarking** — embeds an identifier into images using DWT-based processing.
* **Visual Fingerprinting** — creates image representations that can be used for similarity matching.
* **Similarity Search** — uses ChromaDB to search registered visual data.
* **Image Forensics** — analyzes image properties and metadata for additional evidence.
* **Ownership Verification** — combines multiple signals when comparing images.
* **DMCA Generation** — creates a structured PDF from the available verification information.

---

## Tech Stack

### Frontend

`Next.js` · `React` · `TypeScript` · `Tailwind CSS`

### Backend

`Python` · `FastAPI` · `OpenCV` · `NumPy` · `Pillow` · `PyWavelets`

### Data & AI

`Firebase` · `ChromaDB` · `Google Gemini`

### Deployment

`Vercel` · `Render`

---

## Project Structure

```text
veris-main/
├── ckm_backend/
│   ├── main.py
│   ├── advanced_watermark.py
│   ├── advanced_fingerprint.py
│   └── forensics.py
│
├── ckm-frontend/
│   ├── app/
│   ├── public/
│   └── package.json
│
├── requirements.txt
└── README.md
```

---

## Getting Started

### Backend

```bash
git clone https://github.com/alifosaur/veris-main.git
cd veris-main

python -m venv .venv
pip install -r requirements.txt

uvicorn ckm_backend.main:app --reload --port 8000
```

### Frontend

```bash
cd ckm-frontend
npm install
npm run dev
```

Create the required `.env` / `.env.local` files with your Firebase, Gemini, ImgBB, and backend configuration.

> **Please don't commit API keys or environment files.**

---

## Current Limitations

VERIS is an ongoing project, so some parts are still experimental.

* Watermark robustness can be improved against heavy image transformations.
* Visual similarity alone does not establish legal ownership.
* Online infringement monitoring is still being developed.
* AI-image detection requires further testing and optimization.

---

## What's Next?

* [ ] Stronger watermark robustness
* [ ] Improved visual similarity
* [ ] Lightweight AI-image detection
* [ ] Backend-based image uploads
* [ ] Automated infringement monitoring
* [ ] Better testing and documentation

---

## A Little Note

VERIS started as an exploration of **image processing, AI, and digital ownership** and has grown into a project where I get to experiment with technologies across the full stack.


