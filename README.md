# VERIS — Digital Content Protection & Ownership Verification

Digital content protection and ownership verification platform for creators.

## Problem Statement
In a world dominated by AI generation, social media, and digital piracy, creators struggle to prove their authorship and prevent unauthorized theft or reuse of their artwork and designs. Metadata is easily stripped, visual differences can confuse standard reverse-image search engines, and generating proof of ownership usually requires complex legal assistance.

## Solution
**VERIS** solves this by establishing a cryptographic and forensic link between the creator and their work. By embedding invisible robust watermarks, registering unique content-based DNA embeddings, and tracking online indexing, VERIS gives creators a sovereign tool to secure, verify, and enforce copyright for their visual assets.

---

## Technical Workflow & System Concept

```text
  CREATE        (Original visual asset designed by creator)
    ↓
  PROTECT       (Embed invisible DWT watermark & extract Visual DNA hash)
    ↓
  REGISTER      (Secure DNA vector in database & register doc in vault registry)
    ↓
  DETECT        (Search online web spaces using Visual search engines)
    ↓
  VERIFY        (Compare scanned image signature, watermark, and similarity scores)
    ↓
  TAKE ACTION   (Generate a verified DMCA Takedown Notice PDF)
```

---

## Key Features

1.  **Invisible Digital Watermarking**: Uses Discrete Wavelet Transform (DWT) LSB steganography to embed secure, invisible identifier signatures into the red/blue color channels.
2.  **Cryptographic Visual DNA**: Generates content-based visual embeddings using Gemini models to index visual features.
3.  **Vector Search Indexing**: Stores asset DNA in Chroma DB to execute near-instant visual similarity cross-references.
4.  **Forensic Checker Radar**: Enables side-by-side verification comparisons between suspicious assets and the registered catalog.
5.  **Online Infringement Tracking**: Uses Google Vision API to index active web pages containing exact or partial visual copies.
6.  **Automated DMCA PDF Notice Generator**: Generates and downloads standard legal takedown letters compiled with forensic evidence matches.

---

## Tech Stack

*   **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS v4, Framer Motion, Lucide Icons, tsParticles
*   **Database & Auth**: Firebase Authentication, Cloud Firestore
*   **Backend Server**: FastAPI, Python 3.11+, Uvicorn
*   **Vector Engine**: Chroma DB
*   **AI Models**: Google Gemini AI Studio (for content-based embeddings)
*   **Forensics & Watermarking**: NumPy, OpenCV, PyWavelets, Pillow, ReportLab (for PDF generation)

---

## Folder Structure

```text
veris-main/
├── .env.example              # Root/Backend environment template
├── .gitignore                # Global git exclusion configuration
├── main.py                   # FastAPI backup/legacy single-route entry
├── requirements.txt          # Python backend dependencies
├── runtime.txt               # Python runtime version definition
├── ckm_backend/              # Primary FastAPI Backend Application
│   ├── main.py               # Main API routes (embed, search, DMCA)
│   ├── advanced_watermark.py # DWT LSB steganography injection logic
│   ├── advanced_fingerprint.py # Visual DNA feature extractions
│   ├── ai_detector.py        # Gemini embedding utilities
│   ├── forensics.py          # Visual similarity calculations
│   └── ckm_db/               # Persistent Chroma Vector Database (local)
└── ckm-frontend/             # Primary Next.js Frontend Application
    ├── .env.example          # Frontend local environment template
    ├── package.json          # Node script dependencies
    ├── app/
    │   ├── page.tsx          # Root router view (Login/Dashboard/Forensics)
    │   ├── firebase.ts       # Firebase config loading client-side
    │   └── globals.css       # Style sheets and Tailwind overrides
    └── public/               # Static assets & favicon
```

---

## Security Considerations

1.  **Exposed Front-End Keys (ImgBB / Firebase)**:
    *   **ImgBB**: The ImgBB API key is called directly from browser-side code during upload pipelines. This is a design limitation that makes the key visible in browser network traces. Rotate this key if you notice abnormal upload volumes.
    *   **Firebase**: The Firebase client configuration is intentionally public and client-facing by design. Write-permissions to Cloud Firestore must be enforced using strict security rules based on authenticated Firebase User IDs.
2.  **Environment Isolation**:
    *   Keep server-side keys (like `GEMINI_API_KEY`) strictly on the backend. They must never be prefixed with `NEXT_PUBLIC_` or loaded in client-side code.

---

## Environment Variables

### Root / Backend `.env` Variables
Create a `.env` file in the root directory:
```env
# Gemini API Key (obtain from Google AI Studio)
GEMINI_API_KEY="your_api_key_here"
```

### Frontend `.env.local` Variables
Create a `.env.local` file inside the `ckm-frontend/` directory:
```env
# Google Cloud Vision key (for web search tracking)
NEXT_PUBLIC_GOOGLE_VISION_KEY="your_google_vision_key_here"

# ImgBB api upload key
NEXT_PUBLIC_IMGBB_API_KEY="your_imgbb_key_here"

# Firebase Public Configuration
NEXT_PUBLIC_FIREBASE_API_KEY="your_firebase_api_key"
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="your_firebase_auth_domain"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="your_firebase_project_id"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="your_firebase_storage_bucket"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="your_firebase_sender_id"
NEXT_PUBLIC_FIREBASE_APP_ID="your_firebase_app_id"
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID="your_firebase_measurement_id"
```

---

## Setup & Deployment Guide

**External services:** Google Gemini API (embeddings), Firebase (auth + user data), ImgBB (sealed image hosting), ChromaDB (local vector store on the backend).

---

### Local Setup

#### Backend
```bash
# Navigate to the repository root (not inside ckm_backend/)
pip install -r requirements.txt --break-system-packages

# Create ckm_backend/.env with:
# GEMINI_API_KEY=your_key_here

# Start the backend reload service
uvicorn ckm_backend.main:app --reload --port 8000
```

#### Frontend
```bash
cd ckm-frontend
npm install

# Create ckm-frontend/.env.local with:
# NEXT_PUBLIC_FIREBASE_API_KEY=...
# NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
# NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
# NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
# NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
# NEXT_PUBLIC_FIREBASE_APP_ID=...
# NEXT_PUBLIC_IMGBB_API_KEY=...
# NEXT_PUBLIC_API_BASE_URL=http://localhost:8000

npm run dev
```

---

### Deployment Notes

*   **Render start command** must be `uvicorn ckm_backend.main:app --host 0.0.0.0 --port $PORT` (run from the repository root, not from inside `ckm_backend/`) — the package structure uses explicit relative imports which require running the server context from the workspace package boundary.
*   **Never commit `.env` or `.env.local`** — both files are gitignored. Secrets belong only in Render's/Vercel's environment variable dashboards.
*   **Secrets Split Scope**: Frontend and backend secrets are split by scope: `NEXT_PUBLIC_*` variables belong in **Vercel**; `GEMINI_API_KEY` belongs in **Render** only — never the reverse.

---

### Security Notes

*   API keys are rotated and never hardcoded; the backend raises a startup error if `GEMINI_API_KEY` is missing rather than falling back to placeholders.
*   The `/scan` endpoint never fabricates a match — a "verified" or "likely" result always requires a real vector similarity score and/or a real watermark extraction check against stored data.

---

## Arctic Forensics Design Philosophy

The interface of VERIS follows the **Arctic Forensics** visual theme, delivering a scientific and highly technical aesthetic that emphasizes accuracy and absolute trust. 

*   **Clinical Palette**: Uses a clean, ice-blue base (`#F5FAFD`) with deep navy (`#07152F`) for stark contrast and structure, highlighted by precision cyan and primary blue highlights.
*   **Technical Telemetry**: General interface texts use the clean geometric sans-serif **Inter**, while all digital DNA visual hashes, system timestamps, and database file records are rendered in **Space Mono** to resemble a technical log screen.
*   **Balanced Radii & Details**: Employs thin cool-grey borders (`#D7E6ED`) and `12px` to `16px` border-radii to give surfaces a modern, premium hardware aesthetic.

---

## Future Roadmap & Limitations
*   **Watermark Durability**: Currently resistant to basic cropping and edits. Future upgrades will implement stronger visual DWT-DCT patterns to combat compression.
*   **Decoupled ImgBB uploads**: Relocate image uploads to server-side backend proxies to hide client-facing keys.
*   **Web Radar**: Integration of automated headless scrapers for continuous threat tracking.

---

## Contributors
*   VERIS Engineering Team

## License
MIT License
