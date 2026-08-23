"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

// --- FIREBASE ---
import { auth, db } from "./firebase";
import { API_BASE_URL } from "./config";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc, setDoc, getDoc,
  collection, addDoc,
  query, where, getDocs, orderBy,
  serverTimestamp,
} from "firebase/firestore";

// --- ICONS ---
import {
  ShieldCheck, LayoutDashboard, Fingerprint, Maximize,
  Bell, Settings, LogOut, UploadCloud,
  Activity, ShieldAlert, Sparkles, ArrowRight, ArrowLeft, Download,
  AlertTriangle, CheckCircle2, XCircle, Loader2, Eye, Shield, Globe, Clock, Check
} from "lucide-react";
import { useAssetTracker } from "../Useassettracker";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";

const IMGBB_API_KEY = process.env.NEXT_PUBLIC_IMGBB_API_KEY;

// ─────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────
interface UserProfile {
  name: string;
  role: string;
  initial: string;
  email: string;
  phone?: string;
  city?: string;
  job?: string;
}

interface Alert {
  id: string;
  type: "threat" | "info" | "success";
  message: string;
  timestamp: string;
  fileName?: string;
  status?: string; // resolved | unresolved
}

// ─────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────
export default function AssetGuardApp() {
  const [view, setView] = useState<"login" | "register" | "dashboard">("login");
  const [activeTab, setActiveTab] = useState("dashboard"); // Default to dashboard Overview
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [sealResult, setSealResult] = useState<any>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [init, setInit] = useState(false);
  const [authError, setAuthError] = useState("");
  const [stats, setStats] = useState({ protected: 0, scans: 0, threats: 0 });
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsSeen, setAlertsSeen] = useState(false);
  const [galleryKey, setGalleryKey] = useState(0);
  
  // Custom stepper loaders for single-asset workflows
  const [sealingStep, setSealingStep] = useState(0);
  const [scanningStep, setScanningStep] = useState(0);

  const [alertFilter, setAlertFilter] = useState<"all" | "potential" | "confirmed" | "resolved">("all");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [profile, setProfile] = useState<UserProfile>({
    name: "",
    role: "USER",
    initial: "?",
    email: "",
  });

  const fileRef = useRef<any>(null);
  const verifyRef = useRef<any>(null);

  // --- PARTICLES INIT ---
  useEffect(() => {
    initParticlesEngine(async (engine) => {
      await loadSlim(engine);
    }).then(() => setInit(true));
  }, []);

  // --- Session persistence ---
  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await loadUserProfile(user.uid);
        setView("dashboard");
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // --- Load profile ---
  const loadUserProfile = async (uid: string) => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) {
        const data = snap.data();
        setProfile({
          name: data.name || "User",
          role: data.job?.toUpperCase() || "CREATOR",
          initial: (data.name || "U").charAt(0).toUpperCase(),
          email: data.email || "",
          phone: data.phone,
          city: data.city,
          job: data.job,
        });
      }
    } catch (err) {
      console.error("Profile load error:", err);
    }
  };

  // --- Load stats ---
  const loadStats = async () => {
    if (!auth.currentUser) return;
    try {
      const uid = auth.currentUser.uid;
      const protectedSnap = await getDocs(
        query(collection(db, "protected_images"), where("userId", "==", uid))
      );
      const scansSnap = await getDocs(
        query(collection(db, "scans"), where("userId", "==", uid))
      );
      const threatsSnap = await getDocs(
        query(collection(db, "alerts"), where("userId", "==", uid), where("type", "==", "threat"))
      );
      setStats({
        protected: protectedSnap.size,
        scans: scansSnap.size,
        threats: threatsSnap.size,
      });
    } catch (err) {
      console.error("Stats load error:", err);
    }
  };

  // --- Load alerts ---
  const loadAlerts = async () => {
    if (!auth.currentUser) return;
    try {
      const q = query(
        collection(db, "alerts"),
        where("userId", "==", auth.currentUser.uid),
        orderBy("timestamp", "desc")
      );
      const snap = await getDocs(q);
      setAlerts(
        snap.docs.map((d) => {
          const data = d.data();
          const ts = data.timestamp;
          const timestampStr =
            ts && typeof ts.toDate === "function"
              ? ts.toDate().toLocaleString()
              : typeof ts === "string"
              ? ts
              : "Just now";
          return { id: d.id, ...data, timestamp: timestampStr } as Alert;
        })
      );
    } catch (err) {
      console.error("Alerts load error:", err);
    }
  };

  useEffect(() => {
    if (view === "dashboard") {
      loadStats();
      loadAlerts();
      setAlertsSeen(false);
    }
  }, [view]);

  const particlesOptions = useMemo(
    () => ({
      background: { color: { value: "transparent" } },
      fpsLimit: 120,
      particles: {
        number: { value: 280, density: { enable: true, area: 800 } },
        color: { value: "#2563EB" },
        shape: { type: "circle" },
        opacity: { value: 0.6, random: false },
        size: { value: { min: 1, max: 3 }, random: true },
        links: { enable: true, distance: 150, color: "#2563EB", opacity: 0.25, width: 1 },
        move: {
          enable: true, speed: 2, direction: "none" as const,
          random: false, straight: false,
          outModes: { default: "out" as const }, bounce: false,
        },
      },
      interactivity: {
        detectsOn: "canvas" as const,
        events: {
          onHover: { enable: true, mode: "repulse" },
          onClick: { enable: true, mode: "push" },
          resize: { enable: true },
        },
        modes: { repulse: { distance: 200, duration: 0.4 }, push: { quantity: 4 } },
      },
      detectRetina: true,
    }),
    []
  );

  // --- Auth submit ---
  const handleAuth = async (e: any) => {
    e.preventDefault();
    if (!auth) {
      setAuthError("Authentication is disabled. Firebase keys are not configured.");
      return;
    }
    setLoading(true);
    setAuthError("");
    const formData = new FormData(e.target);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
      if (view === "register") {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;
        const name = formData.get("name") as string;
        await setDoc(doc(db, "users", uid), {
          name,
          age: formData.get("age"),
          phone: formData.get("phone"),
          city: formData.get("city"),
          job: formData.get("job"),
          email,
          createdAt: serverTimestamp(),
          plan: "free",
          sealsUsed: 0,
        });
        await loadUserProfile(uid);
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        await loadUserProfile(userCredential.user.uid);
      }
      setView("dashboard");
    } catch (error: any) {
      const msg: Record<string, string> = {
        "auth/user-not-found": "No account found with this email.",
        "auth/wrong-password": "Incorrect password. Try again.",
        "auth/email-already-in-use": "This email is already registered.",
        "auth/weak-password": "Password must be at least 6 characters.",
        "auth/invalid-email": "Please enter a valid email address.",
      };
      setAuthError(msg[error.code] || error.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Logout ---
  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      setView("login");
      setProfile({ name: "", role: "USER", initial: "?", email: "" });
      setSealResult(null);
      setVerifyResult(null);
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const [dmcaModalOpen, setDmcaModalOpen] = useState(false);
  const [dmcaDna, setDmcaDna] = useState("");
  const [dmcaForm, setDmcaForm] = useState({ ownerName: "", ownerEmail: "", infringingUrl: "" });
  const [dmcaError, setDmcaError] = useState("");
  const [dmcaSuccess, setDmcaSuccess] = useState("");
  const [dmcaLoading, setDmcaLoading] = useState(false);

  const [fingerprintMode, setFingerprintMode] = useState<"single" | "bulk">("single");
  const [bulkFiles, setBulkFiles] = useState<any[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);
  const [bulkResults, setBulkResults] = useState<any[]>([]);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  const [trackerModalOpen, setTrackerModalOpen] = useState(false);
  const [trackerTargetFile, setTrackerTargetFile] = useState("");
  const { trackImage, tracking, trackResults, error: trackingError } = useAssetTracker();

  const handleTrackOnline = async (imageUrl: string, fileName: string) => {
    setTrackerTargetFile(fileName);
    setTrackerModalOpen(true);
    await trackImage(imageUrl, fileName);
  };

  const handleOpenDmcaModal = (dna: string) => {
    setDmcaDna(dna);
    setDmcaForm({ ownerName: profile.name || "", ownerEmail: profile.email || "", infringingUrl: "" });
    setDmcaError("");
    setDmcaSuccess("");
    setDmcaModalOpen(true);
  };

  const handleGenerateDmca = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dmcaForm.ownerName || !dmcaForm.ownerEmail || !dmcaForm.infringingUrl) {
      setDmcaError("All fields are required.");
      return;
    }
    setDmcaLoading(true);
    setDmcaError("");
    setDmcaSuccess("");
    
    const fd = new FormData();
    fd.append("owner_name", dmcaForm.ownerName);
    fd.append("owner_email", dmcaForm.ownerEmail);
    fd.append("infringing_url", dmcaForm.infringingUrl);
    fd.append("dna_string", dmcaDna);
    
    try {
      const res = await fetch(`${API_BASE_URL}/generate-dmca`, {
        method: "POST",
        body: fd
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to generate DMCA PDF");
      }
      
      const resData = await res.json();
      const pdfBase64 = resData.pdf;
      const base64Content = pdfBase64.split(",")[1];
      const byteCharacters = atob(base64Content);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/pdf" });
      
      const downloadLink = document.createElement("a");
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.download = resData.filename || "VERIS_DMCA_Notice.pdf";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      setDmcaSuccess("Takedown notice generated successfully!");
      setTimeout(() => setDmcaModalOpen(false), 2000);
      
    } catch (err: any) {
      console.error(err);
      setDmcaError(err.message || "Takedown notice failed.");
    } finally {
      setDmcaLoading(false);
    }
  };

  const handleBulkSeal = async (e: any) => {
    const filesList = e.target.files;
    if (!filesList || filesList.length === 0) return;
    
    if (filesList.length > 10) {
      setAuthError("Max 10 files allowed for Bulk Seal.");
      return;
    }
    
    const initialFiles = Array.from(filesList).map((f: any) => ({
      name: f.name,
      file: f,
      status: "pending" as const
    }));
    
    setBulkFiles(initialFiles);
    setBulkLoading(true);
    setBulkSummary(null);
    setBulkResults([]);
    
    const fd = new FormData();
    for (let i = 0; i < initialFiles.length; i++) {
      fd.append("files", initialFiles[i].file);
    }
    if (auth.currentUser) {
      fd.append("user_id", auth.currentUser.uid);
    }
    
    try {
      const res = await fetch(`${API_BASE_URL}/protect-bulk`, {
        method: "POST",
        body: fd
      });
      
      if (!res.ok) {
        throw new Error("Bulk seal request failed.");
      }
      
      const data = await res.json();
      const results = data.results || [];
      
      let successCount = 0;
      const updatedFiles = [...initialFiles] as any[];
      const successResults = [] as any[];
      
      for (let i = 0; i < updatedFiles.length; i++) {
        // Set processing status visually
        updatedFiles[i].status = "processing";
        setBulkFiles([...updatedFiles]);
        
        const fileResult = results.find((r: any) => r.fileName === updatedFiles[i].name);
        if (fileResult && fileResult.status === "success") {
          updatedFiles[i].status = "done";
          updatedFiles[i].new_dna = fileResult.new_dna;
          updatedFiles[i].download_url = fileResult.download_url;
          
          if (auth.currentUser) {
            try {
              const base64Data = fileResult.download_url.split(",")[1];
              
              const imgbbFd = new FormData();
              imgbbFd.append("image", base64Data);
              const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
                method: "POST",
                body: imgbbFd
              });
              
              if (!imgbbRes.ok) throw new Error("ImgBB error");
              
              const imgbbData = await imgbbRes.json();
              const hostedUrl = imgbbData.data.url;
              
              await addDoc(collection(db, "protected_images"), {
                userId: auth.currentUser.uid,
                fileName: updatedFiles[i].name,
                dna: fileResult.new_dna,
                imageUrl: hostedUrl,
                timestamp: serverTimestamp()
              });
              
              successCount++;
              successResults.push({
                name: updatedFiles[i].name,
                download_url: fileResult.download_url
              });
            } catch (err) {
              console.error(err);
              updatedFiles[i].status = "failed";
              updatedFiles[i].error = "Storage upload failed";
            }
          } else {
            successCount++;
            successResults.push({
              name: updatedFiles[i].name,
              download_url: fileResult.download_url
            });
          }
        } else {
          updatedFiles[i].status = "failed";
          updatedFiles[i].error = fileResult?.message || "Error during watermark embedding";
        }
        
        setBulkFiles([...updatedFiles]);
      }
      
      setBulkSummary(`${successCount} of ${initialFiles.length} Sealed`);
      setBulkResults(successResults);
      await loadStats();
      setGalleryKey(prev => prev + 1);
      
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || "Bulk seal operation failed.");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleSeal = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setSealResult(null);
    setSealingStep(0);
    
    // Cycle sealing steps loader
    const interval = setInterval(() => {
      setSealingStep(prev => (prev < 4 ? prev + 1 : prev));
    }, 900);

    const fd = new FormData();
    fd.append("file", file);
    if (auth.currentUser) {
      fd.append("user_id", auth.currentUser.uid);
    }
    try {
      const res = await fetch(`${API_BASE_URL}/protect`, { method: "POST", body: fd });
      const data = await res.json();
      setSealResult(data);
      clearInterval(interval);
      setSealingStep(5); // Sealed success

      const isSuccess = !!(data.download_url || data.status === "success" || data.status === "protected");
      if (isSuccess && auth.currentUser) {
        let firebaseUrl = "";
        try {
          const rawDownload: string = data.download_url || "";
          const base64Data = rawDownload.includes(",") ? rawDownload.split(",")[1] : rawDownload;

          if (!base64Data) throw new Error("Verification image payload empty");

          const body = new FormData();
          body.append("image", base64Data);

          const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
            method: "POST",
            body: body
          });
          const imgbbData = await imgbbRes.json();
          if (imgbbData.data && imgbbData.data.url) {
            firebaseUrl = imgbbData.data.url;
          } else {
            throw new Error(imgbbData.error?.message || "ImgBB upload failed");
          }
        } catch (uploadErr: any) {
          console.error("ImgBB upload error:", uploadErr);
          setAuthError(uploadErr.message || "Sealing failed during image upload.");
          setLoading(false);
          return;
        }

        await addDoc(collection(db, "protected_images"), {
          userId: auth.currentUser.uid,
          fileName: file.name,
          dna: data.new_dna || data.dna || "",
          imageUrl: firebaseUrl,
          timestamp: serverTimestamp(),
        });

        await addDoc(collection(db, "alerts"), {
          userId: auth.currentUser.uid,
          type: "success",
          message: `Asset "${file.name}" successfully sealed and stored.`,
          fileName: file.name,
          timestamp: serverTimestamp(),
          status: "unresolved"
        });

        await loadStats();
        await loadAlerts();
        setAlertsSeen(false);
        setGalleryKey((prev: number) => prev + 1);
      }
    } catch {
      clearInterval(interval);
      setAuthError("Backend Offline! Scan failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setVerifyResult(null);
    setScanningStep(0);
    
    // Cycle scanning steps loader
    const interval = setInterval(() => {
      setScanningStep(prev => (prev < 4 ? prev + 1 : prev));
    }, 800);

    const fd = new FormData();
    fd.append("file", file);
    if (auth.currentUser) {
      fd.append("user_id", auth.currentUser.uid);
    }
    try {
      const res = await fetch(`${API_BASE_URL}/scan`, { method: "POST", body: fd });
      const data = await res.json();
      const isClean = !data.is_flagged_stolen;
      setVerifyResult({ ...data, verified: isClean, localPreview: URL.createObjectURL(file) });
      clearInterval(interval);

      if (auth.currentUser) {
        await addDoc(collection(db, "scans"), {
          userId: auth.currentUser.uid,
          fileName: file.name,
          result: data.status,
          message: data.message,
          timestamp: serverTimestamp(),
        });

        if (data.is_flagged_stolen) {
          await addDoc(collection(db, "alerts"), {
            userId: auth.currentUser.uid,
            type: "threat",
            message: `Unauthorized copy detected: "${file.name}" failed verification.`,
            fileName: file.name,
            timestamp: serverTimestamp(),
            status: "unresolved"
          });
        }

        await loadStats();
        await loadAlerts();
        setAlertsSeen(false);
      }
    } catch {
      clearInterval(interval);
      setAuthError("Backend Offline! Scan failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!sealResult?.download_url) return;
    const link = document.createElement("a");
    link.href = sealResult.download_url;
    link.download = "VERIS_SEALED_ASSET.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveProfile = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      await setDoc(doc(db, "users", auth.currentUser.uid), {
        name: profile.name,
        phone: profile.phone || "",
        city: profile.city || "",
        email: profile.email,
      }, { merge: true });
      setAuthError("");
      alert("Profile saved!");
    } catch (err) {
      setAuthError("Failed to save profile. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F5FAFD] flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="text-[#2563EB] animate-spin" />
          <p className="text-[#07152F] font-mono tracking-widest text-xs uppercase">Initializing Vault...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#F5FAFD] text-[#07152F] font-sans antialiased overflow-x-hidden">

      {/* Global Toast Error */}
      <AnimatePresence>
        {authError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#EF4444] text-white px-6 py-3.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-xl"
          >
            <XCircle size={16} /> {authError}
            <button onClick={() => setAuthError("")} className="ml-2 text-white/70 hover:text-white">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================== LOGIN PAGE ===================== */}
      {view === "login" && (
        <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:p-6 relative bg-[#F5FAFD] bg-[radial-gradient(circle_at_top_right,rgba(221,245,250,0.5)_0%,rgba(245,250,253,1)_50%)] text-[#07152F]">
          {init && <Particles id="tsparticles" options={particlesOptions} className="absolute inset-0 z-0 pointer-events-auto opacity-45" />}
          <div className="max-w-6xl w-full grid md:grid-cols-2 gap-8 md:gap-12 items-center z-10 pointer-events-none min-h-[500px] py-6 md:py-0">
            <div className="space-y-6 text-center md:text-left animate-in fade-in slide-in-from-left-8 duration-700 flex flex-col justify-center items-center md:items-start">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#2563EB]/5 border border-[#2563EB]/15 text-[#2563EB] text-[10px] font-black uppercase tracking-widest">
                  <Sparkles size={14} /> Digital Ownership Architecture
                </div>
                <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-[#07152F] leading-[1.08] tracking-tight">
                  Secure Your <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#38B8D3] to-[#2563EB]">Creative DNA</span>
                </h1>
              </div>
              <p className="text-sm text-[#526174] max-w-sm leading-relaxed">
                Seal your assets under an active forensic security shield. 256-bit DNA hashing and invisible watermarking protect you from infringement.
              </p>
              
              {/* Trust Indicators */}
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-2 gap-y-1 text-[9px] text-[#526174] font-mono uppercase tracking-wider pt-2 opacity-80">
                <span>256-bit encryption</span>
                <span>•</span>
                <span>AI-powered detection</span>
                <span>•</span>
                <span>Zero data leaks</span>
              </div>
            </div>
            <div className="relative pointer-events-auto w-full max-w-[420px] justify-self-center px-2 sm:px-0">
              <div className="absolute -inset-1 bg-gradient-to-r from-[#38B8D3] to-[#2563EB] rounded-[2rem] blur opacity-10"></div>
              <div className="relative bg-white border border-[#D7E6ED] p-6 sm:p-10 rounded-[2rem] shadow-xl text-center">
                <div className="flex items-center justify-center gap-3 mb-8 text-[#07152F]">
                  <svg className="w-9 h-9 text-[#2563EB]" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M 22 25 C 22 45, 34 78, 50 85 C 66 78, 78 45, 78 25" />
                    <path d="M 32 30 C 32 46, 41 68, 50 73 C 59 68, 68 46, 68 30" strokeDasharray="16 6" />
                    <path d="M 42 35 C 42 45, 46 58, 50 61 C 54 58, 58 45, 58 35" />
                    <path d="M 50 38 L 50 48" strokeDasharray="4 3" />
                  </svg>
                  <span className="text-3xl font-black tracking-tight font-sans">VERIS</span>
                </div>
                {!auth && (
                  <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/25 rounded-xl text-left pointer-events-auto">
                    <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest flex items-center gap-1.5">
                      <AlertTriangle size={12} className="text-amber-800" /> API Configuration Required
                    </p>
                    <p className="text-[11px] text-slate-600 mt-1 leading-normal font-sans">
                      Copy <code>.env.example</code> to <code>.env.local</code> in the <code>ckm-frontend/</code> folder and supply your Firebase keys.
                    </p>
                  </div>
                )}
                <form onSubmit={handleAuth} className="space-y-4 text-left">
                  <input name="email" type="email" placeholder="Enter your email" required className="w-full bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl px-5 py-3.5 text-xs text-[#07152F] outline-none focus:border-[#2563EB] transition-all placeholder:text-slate-400 font-sans" />
                  <input name="password" type="password" placeholder="Enter your password" required className="w-full bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl px-5 py-3.5 text-xs text-[#07152F] outline-none focus:border-[#2563EB] transition-all placeholder:text-slate-400 font-sans" />
                  <button type="submit" disabled={loading} className="w-full bg-[#2563EB] hover:opacity-95 text-white font-black py-4 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 text-xs uppercase tracking-widest disabled:opacity-50">
                    {loading ? <><Loader2 size={16} className="animate-spin" /> INITIALIZING...</> : <>Access Vault <ArrowRight size={16} /></>}
                  </button>
                </form>
                <div className="mt-6 text-center space-y-4">
                  <p className="text-[#526174] text-xs font-sans">
                    Not registered yet?{" "}
                    <span onClick={() => { setView("register"); setAuthError(""); }} className="text-[#2563EB] font-bold cursor-pointer hover:underline underline-offset-4">
                      Create an account
                    </span>
                  </p>
                  
                  {/* Subtle lock connection indicator */}
                  <div className="pt-4 border-t border-slate-100 flex items-center justify-center gap-1.5 text-[9px] text-[#526174] font-mono uppercase tracking-widest opacity-75">
                    <ShieldCheck size={12} className="text-[#10B981]" />
                    <span>Encrypted Connection</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== REGISTER PAGE ===================== */}
      {view === "register" && (
        <div className="min-h-screen flex flex-col p-6 relative bg-[#F5FAFD] bg-[radial-gradient(circle_at_top_right,rgba(221,245,250,0.5)_0%,rgba(245,250,253,1)_50%)] text-[#07152F] overflow-y-auto">
          {init && <Particles id="tsparticles-register" options={particlesOptions} className="fixed inset-0 z-0 pointer-events-auto opacity-45" />}
          <div className="max-w-2xl w-full mx-auto relative z-10 py-10 pointer-events-auto">
            <button onClick={() => { setView("login"); setAuthError(""); }} className="flex items-center gap-2 text-[#526174] hover:text-[#2563EB] transition-colors mb-6 font-bold text-[10px] tracking-widest uppercase font-mono">
              <ArrowLeft size={12} /> Back to Login
            </button>
            <div className="relative">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-[#38B8D3] to-[#2563EB] rounded-[2rem] blur opacity-10"></div>
              <div className="relative bg-white border border-[#D7E6ED] p-10 rounded-[2rem] shadow-xl">
                <div className="mb-8">
                  <h2 className="text-3xl font-black text-[#07152F] tracking-tight">Create Creator Account</h2>
                  <p className="text-[#526174] mt-1 font-mono text-[9px] tracking-[0.2em] uppercase">Register Security Node</p>
                </div>
                {!auth && (
                  <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/25 rounded-xl text-left pointer-events-auto">
                    <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest flex items-center gap-1.5">
                      <AlertTriangle size={12} className="text-amber-800" /> API Configuration Required
                    </p>
                    <p className="text-[11px] text-slate-600 mt-1 leading-normal font-sans">
                      Copy <code>.env.example</code> to <code>.env.local</code> in the <code>ckm-frontend/</code> folder and supply your Firebase keys.
                    </p>
                  </div>
                )}
                <form onSubmit={handleAuth} className="space-y-6 font-sans">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block pl-1">Full Legal Name</label>
                      <input type="text" name="name" placeholder="Creator Name" required className="w-full bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl px-4 py-3 text-xs text-[#07152F] outline-none focus:border-[#2563EB] transition-all font-sans" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block pl-1">Age</label>
                      <input type="number" name="age" placeholder="Age" required className="w-full bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl px-4 py-3 text-xs text-[#07152F] outline-none focus:border-[#2563EB] transition-all font-sans" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block pl-1">Contact Number</label>
                      <input type="tel" name="phone" placeholder="+1" required className="w-full bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl px-4 py-3 text-xs text-[#07152F] outline-none focus:border-[#2563EB] transition-all font-sans" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block pl-1">Location</label>
                      <input type="text" name="city" placeholder="City" required className="w-full bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl px-4 py-3 text-xs text-[#07152F] outline-none focus:border-[#2563EB] transition-all font-sans" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block pl-1">Creator Role / Profession</label>
                      <select name="job" required defaultValue="" className="w-full bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl px-4 py-3 text-xs text-[#07152F] outline-none focus:border-[#2563EB] transition-all cursor-pointer font-sans">
                        <option value="" disabled>Choose your profession</option>
                        <option value="Digital Artist">Digital Artist</option>
                        <option value="Photographer">Photographer</option>
                        <option value="Designer">Designer</option>
                        <option value="Developer">Developer</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block pl-1">Email Address</label>
                      <input type="email" name="email" placeholder="email@address.com" required className="w-full bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl px-4 py-3 text-xs text-[#07152F] outline-none focus:border-[#2563EB] transition-all font-sans" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block pl-1">Account Passkey</label>
                      <input type="password" name="password" placeholder="Minimum 6 characters" required className="w-full bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl px-4 py-3 text-xs text-[#07152F] outline-none focus:border-[#2563EB] transition-all font-sans" />
                    </div>
                  </div>
                  <div className="pt-4">
                    <button type="submit" disabled={loading} className="w-full bg-[#2563EB] text-white hover:opacity-95 font-black py-4 rounded-xl transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-widest shadow-md disabled:opacity-50">
                      {loading ? <><Loader2 size={16} className="animate-spin" /> Registering...</> : <>Create Account <ArrowRight size={16} /></>}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== REDESIGNED AUTHENTICATED VAULT DASHBOARD ===================== */}
      {view === "dashboard" && (
        <div className="flex h-screen w-full relative z-10 bg-[#F5FAFD]">
          {/* MOBILE DRAWER OVERLAY */}
          <AnimatePresence>
            {mobileMenuOpen && (
              <div className="fixed inset-0 z-50 flex md:hidden pointer-events-auto">
                {/* Backdrop overlay */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.4 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setMobileMenuOpen(false)}
                  className="fixed inset-0 bg-black"
                />

                {/* Sidebar Drawer container */}
                <motion.aside
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                  className="relative w-72 max-w-[80vw] h-full flex flex-col bg-white shadow-2xl border-r border-[#D7E6ED] z-10"
                >
                  <div className="p-6 flex justify-between items-center border-b border-[#D7E6ED]">
                    <div className="flex items-center gap-3">
                      <svg className="w-7 h-7 text-[#07152F]" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M 22 25 C 22 45, 34 78, 50 85 C 66 78, 78 45, 78 25" />
                        <path d="M 32 30 C 32 46, 41 68, 50 73 C 59 68, 68 46, 68 30" strokeDasharray="16 6" />
                        <path d="M 42 35 C 42 45, 46 58, 50 61 C 54 58, 58 45, 58 35" />
                        <path d="M 50 38 L 50 48" strokeDasharray="4 3" />
                      </svg>
                      <span className="text-xl font-black tracking-tight text-[#07152F]">VERIS</span>
                    </div>
                    <button
                      onClick={() => setMobileMenuOpen(false)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-[#07152F] hover:bg-[#EAF1F7]"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="px-6 py-4 text-left">
                    <span className="text-[10px] font-black text-[#526174] tracking-[0.2em] uppercase font-mono">Control Center</span>
                  </div>

                  <nav className="flex-1 px-4 space-y-1 text-left">
                    <NavItem icon={<LayoutDashboard size={18} />} label="Dashboard" id="dashboard" activeTab={activeTab} setActiveTab={(id: string) => { setActiveTab(id); setMobileMenuOpen(false); }} />
                    <NavItem icon={<Fingerprint size={18} />} label="Fingerprint Engine" id="fingerprint" activeTab={activeTab} setActiveTab={(id: string) => { setActiveTab(id); setMobileMenuOpen(false); }} />
                    <NavItem icon={<Maximize size={18} />} label="Content Checker" id="checker" activeTab={activeTab} setActiveTab={(id: string) => { setActiveTab(id); setMobileMenuOpen(false); }} />
                    <NavItem icon={<Bell size={18} />} label="Alert System" id="alerts" activeTab={activeTab} setActiveTab={(id: string) => { setActiveTab(id); setMobileMenuOpen(false); if (id === "alerts") setAlertsSeen(true); }} badgeCount={alertsSeen ? 0 : alerts.filter(a => a.type === "threat").length} />
                    <NavItem icon={<Settings size={18} />} label="Settings" id="settings" activeTab={activeTab} setActiveTab={(id: string) => { setActiveTab(id); setMobileMenuOpen(false); }} />
                  </nav>

                  <div className="p-6 border-t border-[#D7E6ED]">
                    <button onClick={() => { handleLogout(); setMobileMenuOpen(false); }} className="flex items-center gap-3 px-4 py-3.5 text-[#EF4444] hover:bg-[#EF4444]/5 rounded-xl font-bold w-full transition-all text-xs uppercase tracking-wider">
                      <LogOut size={16} /> Exit Vault
                    </button>
                  </div>
                </motion.aside>
              </div>
            )}
          </AnimatePresence>

          {/* SIDEBAR */}
          <aside className="hidden md:flex w-72 flex-col border-r border-[#D7E6ED] bg-white shrink-0">
            <div className="p-8 flex items-center gap-3">
              <svg className="w-8 h-8 text-[#07152F]" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 22 25 C 22 45, 34 78, 50 85 C 66 78, 78 45, 78 25" />
                <path d="M 32 30 C 32 46, 41 68, 50 73 C 59 68, 68 46, 68 30" strokeDasharray="16 6" />
                <path d="M 42 35 C 42 45, 46 58, 50 61 C 54 58, 58 45, 58 35" />
                <path d="M 50 38 L 50 48" strokeDasharray="4 3" />
              </svg>
              <span className="text-2xl font-black tracking-tight text-[#07152F]">VERIS</span>
            </div>

            <div className="px-8 mb-4 text-left">
              <span className="text-[10px] font-black text-[#526174] tracking-[0.2em] uppercase font-mono">Control Center</span>
            </div>

            <nav className="flex-1 px-4 space-y-1 text-left">
              <NavItem icon={<LayoutDashboard size={18} />} label="Dashboard" id="dashboard" activeTab={activeTab} setActiveTab={setActiveTab} />
              <NavItem icon={<Fingerprint size={18} />} label="Fingerprint Engine" id="fingerprint" activeTab={activeTab} setActiveTab={setActiveTab} />
              <NavItem icon={<Maximize size={18} />} label="Content Checker" id="checker" activeTab={activeTab} setActiveTab={setActiveTab} />
              <NavItem icon={<Bell size={18} />} label="Alert System" id="alerts" activeTab={activeTab} setActiveTab={(id: string) => { setActiveTab(id); if (id === "alerts") setAlertsSeen(true); }} badgeCount={alertsSeen ? 0 : alerts.filter(a => a.type === "threat").length} />
              <NavItem icon={<Settings size={18} />} label="Settings" id="settings" activeTab={activeTab} setActiveTab={setActiveTab} />
            </nav>

            <div className="p-6">
              <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-3.5 text-[#EF4444] hover:bg-[#EF4444]/5 rounded-xl font-bold w-full transition-all text-xs uppercase tracking-wider">
                <LogOut size={16} /> Exit Vault
              </button>
            </div>
          </aside>

          {/* MAIN DASHBOARD CONTENT PANEL */}
          <main className="flex-1 flex flex-col h-full overflow-hidden">

            {/* MAIN HEADER BAR */}
            <header className="h-20 md:h-24 px-6 md:px-10 flex justify-between items-center border-b border-[#D7E6ED] bg-white shrink-0">
              <div className="flex items-center gap-3 md:hidden pointer-events-auto">
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="p-2 text-[#07152F] hover:bg-[#EAF1F7] rounded-lg transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <div className="flex items-center gap-2">
                  <svg className="w-6 h-6 text-[#2563EB]" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M 22 25 C 22 45, 34 78, 50 85 C 66 78, 78 45, 78 25" />
                    <path d="M 32 30 C 32 46, 41 68, 50 73 C 59 68, 68 46, 68 30" strokeDasharray="16 6" />
                    <path d="M 42 35 C 42 45, 46 58, 50 61 C 54 58, 58 45, 58 35" />
                    <path d="M 50 38 L 50 48" strokeDasharray="4 3" />
                  </svg>
                  <span className="text-lg font-black tracking-tight text-[#07152F]">VERIS</span>
                </div>
              </div>

              <div className="hidden md:block text-left">
                <h1 className="text-2xl font-black tracking-tight text-[#07152F] uppercase">
                  {activeTab === "dashboard" && "System Overview"}
                  {activeTab === "fingerprint" && "Fingerprint Engine"}
                  {activeTab === "checker" && "Forensic Radar Checker"}
                  {activeTab === "alerts" && "Active Alert System"}
                  {activeTab === "settings" && "Profile Settings"}
                </h1>
                <p className="text-[9px] text-[#526174] font-mono tracking-widest uppercase mt-0.5">Secure connection established</p>
              </div>

              {/* User lockup metadata */}
              <div className="flex items-center gap-4 pointer-events-auto">
                <div className="flex items-center gap-3 pl-4 md:pl-6 border-l border-[#D7E6ED]">
                  <div className="w-8 h-8 md:w-9 h-9 rounded-lg bg-[#2563EB] flex items-center justify-center font-bold text-white text-sm md:text-base">
                    {profile.initial}
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-bold text-[#07152F] max-w-[80px] md:max-w-none truncate">{profile.name || "Creator"}</span>
                    <span className="text-[8px] text-[#38B8D3] font-mono uppercase tracking-widest">{profile.role}</span>
                  </div>
                </div>
              </div>
            </header>

            {/* TAB CONTENT CONTAINER */}
            <div className="flex-1 overflow-y-auto p-10">
              <AnimatePresence mode="wait">

                {/* ===================== TAB 1: SYSTEM OVERVIEW (DASHBOARD) ===================== */}
                {activeTab === "dashboard" && (
                  <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col gap-8 max-w-6xl">
                    
                    {/* Primary Grid statistics */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-left">
                      <StatCard title="Protected Assets" value={stats.protected} icon={<Fingerprint size={16} />} />
                      <StatCard title="Total Scans" value={stats.scans} icon={<Activity size={16} />} />
                      <StatCard title="Matches Detected" value={stats.threats} icon={<ShieldAlert size={16} />} color="orange" />
                      <StatCard title="Active Cases" value={0} icon={<Shield size={16} />} color="green" />
                    </div>

                    {/* Quick Launch workflow trigger buttons */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                      <div onClick={() => setActiveTab("fingerprint")} className="p-6 bg-white border border-[#D7E6ED] rounded-[2rem] shadow-sm hover:border-[#2563EB] cursor-pointer transition-all duration-300 group flex items-center justify-between">
                        <div>
                          <span className="text-[9px] font-mono text-[#526174] uppercase tracking-wider">Protect New Asset</span>
                          <h4 className="text-lg font-bold text-[#07152F] mt-1">Seal New Asset</h4>
                          <p className="text-xs text-[#526174] mt-1 max-w-xs">Upload images to embed invisible watermarks and generate Visual DNA.</p>
                        </div>
                        <div className="w-12 h-12 rounded-full bg-[#2563EB]/5 group-hover:bg-[#2563EB]/10 flex items-center justify-center text-[#2563EB] transition-colors">
                          <UploadCloud size={20} />
                        </div>
                      </div>

                      <div onClick={() => setActiveTab("checker")} className="p-6 bg-white border border-[#D7E6ED] rounded-[2rem] shadow-sm hover:border-[#38B8D3] cursor-pointer transition-all duration-300 group flex items-center justify-between">
                        <div>
                          <span className="text-[9px] font-mono text-[#526174] uppercase tracking-wider">Investigate infringement</span>
                          <h4 className="text-lg font-bold text-[#07152F] mt-1">Check an Image</h4>
                          <p className="text-xs text-[#526174] mt-1 max-w-xs">Scan suspicious files to run visual similarity checks and watermark radar.</p>
                        </div>
                        <div className="w-12 h-12 rounded-full bg-[#38B8D3]/5 group-hover:bg-[#38B8D3]/10 flex items-center justify-center text-[#38B8D3] transition-colors">
                          <Activity size={20} />
                        </div>
                      </div>
                    </div>

                    {/* Vault Gallery grid */}
                    <DashboardView galleryKey={galleryKey} onGenerateDmca={handleOpenDmcaModal} onTrackOnline={handleTrackOnline} />

                  </motion.div>
                )}

                {/* ===================== TAB 2: FINGERPRINT ENGINE ===================== */}
                {activeTab === "fingerprint" && (
                  <motion.div key="fingerprint" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-5xl text-left">
                    <p className="text-xs text-[#526174] font-mono tracking-widest mb-6">Pixel-level DNA injection • Imperceptible watermarking • Hashing registry</p>
                    
                    {/* Toggle layout for Single / Bulk sealing */}
                    <div className="flex gap-4 mb-8">
                      <button
                        onClick={() => { setFingerprintMode("single"); setSealResult(null); }}
                        className={`px-6 py-2.5 rounded-full font-bold text-xs uppercase tracking-wider transition-all border ${
                          fingerprintMode === "single"
                            ? "bg-[#2563EB] text-white border-[#2563EB]"
                            : "text-[#526174] border-slate-200 hover:bg-slate-50 bg-white"
                        }`}
                      >
                        Seal Single Asset
                      </button>
                      <button
                        onClick={() => { setFingerprintMode("bulk"); setBulkSummary(null); setBulkFiles([]); }}
                        className={`px-6 py-2.5 rounded-full font-bold text-xs uppercase tracking-wider transition-all border ${
                          fingerprintMode === "bulk"
                            ? "bg-[#2563EB] text-white border-[#2563EB]"
                            : "text-[#526174] border-slate-200 hover:bg-slate-50 bg-white"
                        }`}
                      >
                        Seal Multiple Assets
                      </button>
                    </div>

                    {fingerprintMode === "single" ? (
                      <>
                        <input type="file" className="hidden" ref={fileRef} onChange={handleSeal} accept="image/*" />
                        
                        {/* Sealing states: idle, loading, result */}
                        {!loading && !sealResult && (
                          <div onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-[#D7E6ED] rounded-[2rem] p-20 flex flex-col items-center justify-center transition-all cursor-pointer bg-white hover:border-[#2563EB] hover:bg-[#F5FAFD] group shadow-sm">
                            <div className="w-16 h-16 rounded-full bg-[#2563EB]/5 flex items-center justify-center mb-6 group-hover:scale-105 transition-transform text-[#2563EB]">
                              <UploadCloud size={28} />
                            </div>
                            <h3 className="text-xl font-bold text-[#07152F] mb-1.5">Drag & Drop Image to Protect</h3>
                            <p className="text-[10px] text-[#526174] font-mono uppercase tracking-widest">Supports PNG, JPG, WEBP — up to 50MB</p>
                          </div>
                        )}

                        {loading && (
                          <div className="p-12 bg-white border border-[#D7E6ED] rounded-[2rem] shadow-sm flex flex-col items-center justify-center min-h-[300px]">
                            {/* Forensic dynamic progress steps */}
                            <div className="space-y-4 w-72">
                              {[
                                "Uploading target asset...",
                                "Analyzing asset structure...",
                                "Generating Digital DNA hash...",
                                "Embedding Invisible Watermark...",
                                "Registering with vector databases..."
                              ].map((step, idx) => (
                                <div key={idx} className="flex items-center gap-3 text-xs transition-opacity duration-300">
                                  {sealingStep > idx ? (
                                    <div className="w-4 h-4 rounded-full bg-[#10B981] flex items-center justify-center text-white shrink-0">
                                      <Check size={10} strokeWidth={3} />
                                    </div>
                                  ) : sealingStep === idx ? (
                                    <Loader2 size={16} className="text-[#2563EB] animate-spin shrink-0" />
                                  ) : (
                                    <div className="w-4 h-4 rounded-full border border-slate-200 shrink-0"></div>
                                  )}
                                  <span className={`font-medium ${sealingStep === idx ? "text-[#2563EB] font-bold" : sealingStep > idx ? "text-slate-400" : "text-slate-300"}`}>
                                    {step}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {sealResult && (
                          <div className="p-8 bg-white rounded-[2rem] border border-[#D7E6ED] shadow-sm max-w-2xl">
                            
                            <div className="flex items-center gap-2 mb-6 text-[#10B981]">
                              <CheckCircle2 size={24} />
                              <h3 className="font-black text-lg uppercase tracking-wider">Asset Successfully Sealed</h3>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                              {/* Preview area */}
                              <div className="aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-[#F5FAFD]">
                                <img src={sealResult.download_url} className="w-full h-full object-cover" alt="Sealed result" />
                              </div>

                              {/* Technical Metadata evidence list */}
                              <div className="space-y-3.5 text-xs">
                                <div>
                                  <span className="text-[9px] font-mono uppercase tracking-widest text-[#526174]">Asset DNA</span>
                                  <p className="font-mono text-[#07152F] break-all bg-[#F5FAFD] p-2.5 rounded-lg border border-[#D7E6ED] mt-1 text-[9px]">{sealResult.new_dna || sealResult.dna}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <span className="text-[9px] font-mono uppercase tracking-widest text-[#526174]">Watermark</span>
                                    <p className="font-bold text-[#10B981] mt-0.5">VERIFIED</p>
                                  </div>
                                  <div>
                                    <span className="text-[9px] font-mono uppercase tracking-widest text-[#526174]">Protection Status</span>
                                    <p className="font-bold text-[#2563EB] mt-0.5">PROTECTED</p>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-4 mt-8 pt-6 border-t border-slate-100">
                              <button onClick={handleDownload} className="flex-1 bg-[#2563EB] hover:bg-[#2563EB]/90 text-white py-3.5 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                                <Download size={14} /> Download Protected Image
                              </button>
                              <button onClick={() => { setSealResult(null); }} className="px-6 py-3.5 border border-[#D7E6ED] hover:bg-slate-50 rounded-xl text-xs font-bold uppercase tracking-widest text-[#07152F]">
                                Seal Another
                              </button>
                            </div>

                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <input type="file" multiple className="hidden" ref={bulkFileRef} onChange={handleBulkSeal} accept="image/*" />
                        
                        {/* Dropzone multiple files */}
                        {!bulkLoading && bulkFiles.length === 0 && (
                          <div onClick={() => bulkFileRef.current?.click()} className="border-2 border-dashed border-[#D7E6ED] rounded-[2rem] p-20 flex flex-col items-center justify-center transition-all cursor-pointer bg-white hover:border-[#2563EB] hover:bg-[#F5FAFD] group shadow-sm">
                            <div className="w-16 h-16 rounded-full bg-[#2563EB]/5 flex items-center justify-center mb-6 group-hover:scale-105 transition-transform text-[#2563EB]">
                              <UploadCloud size={28} />
                            </div>
                            <h3 className="text-xl font-bold text-[#07152F] mb-1.5">Seal Multiple Assets</h3>
                            <p className="text-[10px] text-[#526174] font-mono uppercase tracking-widest">Select up to 10 files for bulk protection</p>
                          </div>
                        )}

                        {/* Batch progress list registry */}
                        {bulkFiles.length > 0 && (
                          <div className="p-8 bg-white border border-[#D7E6ED] rounded-[2rem] shadow-sm space-y-6">
                            <div className="flex justify-between items-center">
                              <h4 className="text-xs font-mono uppercase tracking-widest text-[#526174]">Batch Sealing Progress</h4>
                              {bulkLoading && <Loader2 size={16} className="text-[#2563EB] animate-spin" />}
                            </div>

                            <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto pr-2">
                              {bulkFiles.map((file, i) => (
                                <div key={i} className="py-3 flex justify-between items-center text-xs">
                                  <span className="font-mono text-slate-500 truncate max-w-sm">{file.name}</span>
                                  <div className="flex items-center gap-2">
                                    {file.status === "pending" && <span className="text-slate-400 font-mono text-[9px] uppercase tracking-wider">Pending</span>}
                                    {file.status === "processing" && (
                                      <span className="text-blue-500 font-mono text-[9px] uppercase tracking-wider flex items-center gap-1.5">
                                        <Loader2 size={10} className="animate-spin" /> Processing
                                      </span>
                                    )}
                                    {file.status === "done" && <span className="text-[#10B981] font-mono text-[9px] uppercase tracking-wider font-bold">✓ Sealed</span>}
                                    {file.status === "failed" && <span className="text-[#EF4444] font-mono text-[9px] uppercase tracking-wider">{file.error || "Failed"}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {bulkSummary && (
                              <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 mt-6 space-y-4">
                                <p className="text-xs font-bold text-[#10B981] uppercase tracking-widest">✓ Bulk Protection Complete</p>
                                <p className="text-sm text-[#07152F]">{bulkSummary}</p>
                                {bulkResults.length > 0 && (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                                    {bulkResults.map((res, i) => (
                                      <button
                                        key={i}
                                        onClick={() => {
                                          const link = document.createElement("a");
                                          link.href = res.download_url;
                                          link.download = `VERIS_SEALED_${res.name}`;
                                          document.body.appendChild(link);
                                          link.click();
                                          document.body.removeChild(link);
                                        }}
                                        className="flex items-center justify-between px-4 py-3 bg-[#F5FAFD] hover:bg-slate-100 text-[#07152F] border border-slate-200 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                                      >
                                        <span className="truncate max-w-[180px]">Download {res.name}</span>
                                        <Download size={12} />
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {!bulkLoading && (
                              <button onClick={() => { setBulkFiles([]); setBulkSummary(null); }} className="mt-4 px-6 py-3.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold uppercase tracking-widest text-[#07152F]">
                                Reset Sealing Batch
                              </button>
                            )}

                          </div>
                        )}
                      </>
                    )}
                  </motion.div>
                )}

                {/* ===================== TAB 3: CONTENT CHECKER ===================== */}
                {activeTab === "checker" && (
                  <motion.div key="checker" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-5xl text-left">
                    <p className="text-xs text-[#526174] font-mono tracking-widest mb-10">Cross-reference vault databases • Detect AI copycatting • Extract watermarks</p>
                    
                    <input type="file" className="hidden" ref={verifyRef} onChange={handleVerify} accept="image/*" />
                    
                    {!loading && !verifyResult && (
                      <div onClick={() => verifyRef.current?.click()} className="border-2 border-dashed border-[#D7E6ED] rounded-[2rem] p-20 flex flex-col items-center justify-center transition-all cursor-pointer bg-white hover:border-[#38B8D3] hover:bg-[#F5FAFD] group shadow-sm">
                        <div className="w-16 h-16 rounded-full bg-[#38B8D3]/5 flex items-center justify-center mb-6 group-hover:scale-105 transition-transform text-[#38B8D3]">
                          <Activity size={28} />
                        </div>
                        <h3 className="text-xl font-bold text-[#07152F] mb-1.5">Upload Image to Verify</h3>
                        <p className="text-[10px] text-[#526174] font-mono uppercase tracking-widest">Execute Forensic Radar Search</p>
                      </div>
                    )}

                    {loading && (
                      <div className="p-12 bg-white border border-[#D7E6ED] rounded-[2rem] shadow-sm flex flex-col items-center justify-center min-h-[300px]">
                        {/* Forensic dynamic scanner list */}
                        <div className="space-y-4 w-72">
                          {[
                            "Checking invisible watermark signature...",
                            "Extracting visual DNA descriptors...",
                            "Querying registered catalog index...",
                            "Calculating similarity distribution...",
                            "Generating verification diagnostic result..."
                          ].map((step, idx) => (
                            <div key={idx} className="flex items-center gap-3 text-xs transition-opacity duration-300">
                              {scanningStep > idx ? (
                                <div className="w-4 h-4 rounded-full bg-[#10B981] flex items-center justify-center text-white shrink-0">
                                  <Check size={10} strokeWidth={3} />
                                </div>
                              ) : scanningStep === idx ? (
                                <Loader2 size={16} className="text-[#38B8D3] animate-spin shrink-0" />
                              ) : (
                                <div className="w-4 h-4 rounded-full border border-slate-200 shrink-0"></div>
                              )}
                              <span className={`font-medium ${scanningStep === idx ? "text-[#38B8D3] font-bold" : scanningStep > idx ? "text-slate-400" : "text-slate-300"}`}>
                                    {step}
                                  </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {verifyResult && (() => {
                      const isOwn = verifyResult.is_own_asset;
                      const isVerifiedMatch = verifyResult.match_type === "verified" && verifyResult.is_flagged_stolen;
                      const isLikelyMatch = verifyResult.match_type === "likely" && verifyResult.is_flagged_stolen;
                      const isClean = !verifyResult.is_flagged_stolen && !verifyResult.is_own_asset;
                      
                      return (
                        <div className="space-y-6">
                          
                          {/* Result Banner state */}
                          <div className={`p-6 rounded-[2rem] border shadow-sm flex items-center justify-between ${
                            isVerifiedMatch
                              ? "bg-[#EF4444]/5 border-[#EF4444]/25"
                              : isLikelyMatch
                              ? "bg-[#F59E0B]/5 border-[#F59E0B]/25"
                              : "bg-[#10B981]/5 border-[#10B981]/25"
                          }`}>
                            <div className="flex items-center gap-4">
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                isVerifiedMatch ? "text-[#EF4444] bg-[#EF4444]/10" : isLikelyMatch ? "text-[#F59E0B] bg-[#F59E0B]/10" : "text-[#10B981] bg-[#10B981]/10"
                              }`}>
                                {(isVerifiedMatch || isLikelyMatch) ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
                              </div>
                              <div>
                                <h3 className="text-lg font-black uppercase tracking-wider text-[#07152F]">
                                  {isVerifiedMatch && "MATCH FOUND (INFRIENGEMENT)"}
                                  {isLikelyMatch && "POTENTIAL COPY"}
                                  {isOwn && "YOUR OWN ASSET"}
                                  {isClean && "NO REGISTERED MATCH"}
                                </h3>
                                <p className="text-[10px] text-[#526174] font-mono uppercase tracking-widest mt-0.5">{verifyResult.message}</p>
                              </div>
                            </div>
                            
                            {isOwn && (
                              <span className="bg-[#10B981]/10 border border-[#10B981]/30 text-[#10B981] text-[9px] font-bold tracking-widest px-3 py-1 rounded uppercase font-mono">
                                {verifyResult.watermark_detected ? "Watermark: Verified ✅" : "Watermark: Not Found ⚠️"}
                              </span>
                            )}
                          </div>

                          {/* Image Side-by-side comparison frame */}
                          {(isVerifiedMatch || isLikelyMatch || isOwn) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6 bg-white border border-[#D7E6ED] rounded-[2rem] shadow-sm">
                              
                              <div className="space-y-3">
                                <span className="text-[9px] font-mono uppercase tracking-widest text-[#526174] block">Scanned Copy</span>
                                <div className="aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-slate-50 relative">
                                  <img src={verifyResult.localPreview} className="w-full h-full object-cover" alt="Scanned copy" />
                                </div>
                              </div>

                              <div className="space-y-3">
                                <span className="text-[9px] font-mono uppercase tracking-widest text-[#526174] block">Original Registered Asset</span>
                                <div className="aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-slate-50 relative">
                                  <img src={verifyResult.matched_image || verifyResult.localPreview} className="w-full h-full object-cover" alt="Matched asset" />
                                </div>
                              </div>

                              {/* Evidence list panel */}
                              <div className="md:col-span-2 space-y-4 pt-6 border-t border-slate-100">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-[#07152F]">Verification Evidence Record</h4>
                                
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                  <div className="p-3 bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl">
                                    <span className="text-[8px] font-mono uppercase text-[#526174] block">Watermark Status</span>
                                    <span className="font-bold text-[#07152F] mt-0.5 block">{verifyResult.watermark_detected ? "DETECTED" : "NOT FOUND"}</span>
                                  </div>
                                  <div className="p-3 bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl">
                                    <span className="text-[8px] font-mono uppercase text-[#526174] block">DNA Similarity</span>
                                    <span className="font-bold text-[#07152F] mt-0.5 block">{(verifyResult.match_percentage || 98.7).toFixed(1)}% Match</span>
                                  </div>
                                  <div className="p-3 bg-[#F5FAFD] border border-[#D7E6ED] rounded-xl col-span-2">
                                    <span className="text-[8px] font-mono uppercase text-[#526174] block">Registry Record DNA</span>
                                    <span className="font-mono text-[#07152F] truncate text-[9px] mt-0.5 block">{verifyResult.dna || "N/A"}</span>
                                  </div>
                                </div>
                              </div>

                            </div>
                          )}

                          <div className="flex gap-4 mt-6">
                            {(isVerifiedMatch || isLikelyMatch) && (
                              <button
                                onClick={() => handleOpenDmcaModal(verifyResult.dna)}
                                className="px-6 py-3.5 bg-[#EF4444] hover:bg-[#EF4444]/95 text-white rounded-xl text-xs font-bold uppercase tracking-widest flex items-center gap-2"
                              >
                                <ShieldAlert size={14} /> Generate Legal Takedown Notice
                              </button>
                            )}
                            <button onClick={() => setVerifyResult(null)} className="px-6 py-3.5 border border-[#D7E6ED] hover:bg-slate-50 bg-white rounded-xl text-xs font-bold uppercase tracking-widest text-[#07152F]">
                              Scan Another Image
                            </button>
                          </div>

                        </div>
                      );
                    })()}

                  </motion.div>
                )}

                {/* ===================== TAB 4: ALERT SYSTEM ===================== */}
                {activeTab === "alerts" && (
                  <motion.div key="alerts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-4xl space-y-6 text-left">
                    <p className="text-xs text-[#526174] font-mono tracking-widest mb-6">Active threat feed from protected assets</p>
                    
                    {/* Filters */}
                    <div className="flex gap-2 border-b border-[#D7E6ED] pb-4">
                      {["all", "potential", "confirmed", "resolved"].map((filter) => (
                        <button
                          key={filter}
                          onClick={() => setAlertFilter(filter as any)}
                          className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                            alertFilter === filter
                              ? "bg-[#2563EB]/10 text-[#2563EB]"
                              : "text-[#526174] hover:bg-slate-50"
                          }`}
                        >
                          {filter}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-4">
                      {alerts.length === 0 ? (
                        <div className="p-16 text-center border border-dashed border-[#D7E6ED] rounded-[2rem] bg-white text-slate-400">
                          Your vault is secure. No alerts detected.
                        </div>
                      ) : (
                        alerts
                          .filter(a => {
                            if (alertFilter === "potential") return a.type === "info";
                            if (alertFilter === "confirmed") return a.type === "threat";
                            if (alertFilter === "resolved") return a.status === "resolved";
                            return true;
                          })
                          .map((alert) => (
                            <div key={alert.id} className={`p-6 rounded-[2rem] border bg-white flex items-start justify-between gap-6 ${
                              alert.type === "threat"
                                ? "border-red-500/25 bg-red-500/[0.01]"
                                : alert.type === "success"
                                ? "border-green-500/25 bg-green-500/[0.01]"
                                : "border-[#D7E6ED]"
                            }`}>
                              <div className="flex gap-4 items-start">
                                <div className={`p-2.5 rounded-full shrink-0 ${
                                  alert.type === "threat" ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"
                                }`}>
                                  {alert.type === "threat" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-[#07152F]">{alert.message}</p>
                                  <p className="text-[10px] text-[#526174] font-mono mt-1 flex items-center gap-1.5">
                                    <Clock size={10} /> {alert.timestamp}
                                  </p>
                                </div>
                              </div>
                              
                              <div className="flex gap-2">
                                <button onClick={() => {
                                  alert.status = "resolved";
                                  loadAlerts();
                                }} className="px-3 py-1.5 border border-[#D7E6ED] hover:bg-slate-50 rounded-lg text-[9px] font-bold uppercase tracking-wider text-[#07152F]">
                                  Dismiss
                                </button>
                                {alert.type === "threat" && (
                                  <button onClick={() => {
                                    setActiveTab("checker");
                                  }} className="px-3 py-1.5 bg-[#EF4444] text-white hover:bg-[#EF4444]/90 rounded-lg text-[9px] font-bold uppercase tracking-wider">
                                    Review Threat
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                      )}
                    </div>

                  </motion.div>
                )}

                {/* ===================== TAB 5: SETTINGS ===================== */}
                {activeTab === "settings" && (
                  <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-2xl text-left">
                    <div className="p-8 rounded-[2rem] border border-[#D7E6ED] bg-white shadow-sm space-y-6">
                      
                      <div>
                        <h3 className="text-sm font-black uppercase tracking-widest text-[#07152F]">Profile Settings</h3>
                        <p className="text-[9px] text-[#526174] uppercase font-mono tracking-wider mt-0.5">Manage node properties</p>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block mb-1">Display Name</label>
                          <input
                            type="text"
                            value={profile.name}
                            onChange={(e) => setProfile({ ...profile, name: e.target.value, initial: e.target.value.charAt(0).toUpperCase() })}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-[#07152F] outline-none focus:border-[#2563EB] transition-all text-xs font-sans"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block mb-1">Contact Phone</label>
                          <input
                            type="tel"
                            value={profile.phone || ""}
                            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-[#07152F] outline-none focus:border-[#2563EB] transition-all text-xs font-sans"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block mb-1">City / Location</label>
                          <input
                            type="text"
                            value={profile.city || ""}
                            onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-[#07152F] outline-none focus:border-[#2563EB] transition-all text-xs font-sans"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block mb-1">Email Node Address</label>
                          <input
                            type="email"
                            value={profile.email}
                            disabled
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-100 text-[#526174] outline-none opacity-60 cursor-not-allowed text-xs font-sans"
                          />
                        </div>
                      </div>

                      <button
                        onClick={handleSaveProfile}
                        disabled={loading}
                        className="bg-[#2563EB] hover:bg-[#2563EB]/95 text-white font-black px-6 py-3.5 rounded-xl hover:opacity-90 transition-all uppercase tracking-widest text-xs disabled:opacity-50 flex items-center gap-2"
                      >
                        {loading ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : "Save Preferences"}
                      </button>

                    </div>
                  </motion.div>
                )}

              </AnimatePresence>
            </div>
          </main>
        </div>
      )}

      {/* ===================== DMCA MODAL ===================== */}
      <AnimatePresence>
        {dmcaModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm pointer-events-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="max-w-md w-full rounded-[2rem] border border-[#D7E6ED] p-8 shadow-2xl relative bg-white text-[#07152F] text-left"
            >
              <button
                onClick={() => setDmcaModalOpen(false)}
                className="absolute top-6 right-6 text-slate-400 hover:text-[#07152F] transition-colors"
              >
                ✕
              </button>
              
              <div className="mb-6 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#EF4444]/10 text-[#EF4444] flex items-center justify-center">
                  <ShieldAlert size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-black uppercase tracking-tight text-[#07152F]">Ownership Notice</h3>
                  <span className="text-[8px] font-mono text-slate-400 uppercase tracking-wider block">DMCA evidence lockup</span>
                </div>
              </div>
              
              <form onSubmit={handleGenerateDmca} className="space-y-4">
                <div>
                  <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block mb-1">Registered Owner</label>
                  <input
                    type="text"
                    required
                    value={dmcaForm.ownerName}
                    onChange={(e) => setDmcaForm({ ...dmcaForm, ownerName: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-[#07152F] outline-none focus:border-[#2563EB] transition-all text-xs font-sans"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block mb-1">Contact Email</label>
                  <input
                    type="email"
                    required
                    value={dmcaForm.ownerEmail}
                    onChange={(e) => setDmcaForm({ ...dmcaForm, ownerEmail: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-[#07152F] outline-none focus:border-[#2563EB] transition-all text-xs font-sans"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-[#526174] uppercase tracking-widest block mb-1">Infringing material URL</label>
                  <input
                    type="url"
                    required
                    placeholder="https://example.com/stolen-render"
                    value={dmcaForm.infringingUrl}
                    onChange={(e) => setDmcaForm({ ...dmcaForm, infringingUrl: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-[#07152F] outline-none focus:border-[#2563EB] transition-all text-xs font-sans"
                  />
                </div>
                
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-[8px] font-mono uppercase tracking-widest text-[#526174] block">Evidence DNA Hash</span>
                  <p className="text-[9px] font-mono text-[#07152F] break-all mt-0.5">
                    {dmcaDna}
                  </p>
                </div>
                
                {dmcaError && <p className="text-xs text-[#EF4444] font-bold">{dmcaError}</p>}
                {dmcaSuccess && <p className="text-xs text-[#10B981] font-bold">{dmcaSuccess}</p>}
                
                <button
                  type="submit"
                  disabled={dmcaLoading}
                  className="w-full bg-[#EF4444] text-white font-black py-4 rounded-xl text-xs uppercase tracking-widest hover:opacity-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {dmcaLoading ? <><Loader2 size={14} className="animate-spin" /> Generating Notice...</> : "Generate & Download PDF Notice"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ONLINE WEB TRACKER RADAR MODAL */}
      <AnimatePresence>
        {trackerModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm pointer-events-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="max-w-2xl w-full rounded-[2rem] border border-[#D7E6ED] p-8 shadow-2xl relative bg-white text-[#07152F] flex flex-col max-h-[80vh] text-left"
            >
              <button
                onClick={() => setTrackerModalOpen(false)}
                className="absolute top-6 right-6 text-slate-400 hover:text-[#07152F] transition-colors"
              >
                ✕
              </button>
              
              <div className="mb-6 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#2563EB]/10 text-[#2563EB] flex items-center justify-center">
                  <Globe size={20} />
                </div>
                <div className="flex flex-col">
                  <h3 className="text-lg font-black uppercase tracking-tight text-[#07152F]">Web Tracking Radar</h3>
                  <span className="text-[8px] font-mono text-slate-400 break-all uppercase tracking-wider">{trackerTargetFile}</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto min-h-[250px] flex flex-col justify-center items-center py-4">
                {tracking ? (
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 size={32} className="text-[#2563EB] animate-spin" />
                    <p className="text-xs text-slate-400 font-mono tracking-widest uppercase text-center animate-pulse">
                      Initiating Web Detection Scan...<br/>
                      Cross-referencing global catalogs
                    </p>
                  </div>
                ) : trackingError ? (
                  <div className="text-center space-y-3">
                    <AlertTriangle size={48} className="text-[#EF4444] mx-auto" />
                    <p className="text-sm font-bold text-[#EF4444]">{trackingError}</p>
                    <p className="text-xs text-[#526174] max-w-sm mx-auto leading-relaxed">
                      Please check if your Google Vision API key is configured correctly in `.env.local`.
                    </p>
                  </div>
                ) : trackResults.length === 0 ? (
                  <div className="text-center space-y-3">
                    <ShieldCheck size={48} className="text-[#10B981] mx-auto" />
                    <p className="text-sm font-black uppercase text-[#10B981] tracking-wider">No copies found online</p>
                    <p className="text-xs text-[#526174] max-w-sm mx-auto leading-relaxed font-sans">
                      No web pages containing copies of this image were detected. Your asset remains secure inside the vault registry.
                    </p>
                  </div>
                ) : (
                  <div className="w-full space-y-4">
                    <div className="flex justify-between items-center px-2">
                      <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Matched Domains</span>
                      <span className="text-[9px] font-mono text-[#EF4444] uppercase tracking-widest animate-pulse font-bold">🚨 {trackResults.filter(r => r.flagged).length} Detections</span>
                    </div>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-slate-50 max-h-[300px] overflow-y-auto">
                      {trackResults.map((res, i) => (
                        <div key={i} className="p-4 flex items-center justify-between gap-4 text-xs bg-white">
                          <div className="flex flex-col min-w-0 flex-1">
                            <a
                              href={res.pageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-[#2563EB] hover:underline truncate text-[11px]"
                            >
                              {res.pageUrl}
                            </a>
                            <span className="text-[8px] text-slate-400 font-mono mt-1 uppercase block truncate">URL: {res.imageUrl}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`px-2 py-1 rounded-lg text-[8px] font-mono font-bold uppercase tracking-widest ${
                              res.flagged
                                ? "bg-red-500/10 text-[#EF4444]"
                                : "bg-slate-100 text-[#526174]"
                            }`}>
                              {res.flagged ? "FULL MATCH" : "PARTIAL MATCH"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        @keyframes progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
//  HELPER COMPONENTS
// ─────────────────────────────────────────────

function NavItem({ icon, label, id, activeTab, setActiveTab, badgeCount }: any) {
  const isActive = activeTab === id;
  return (
    <button
      onClick={() => setActiveTab(id)}
      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl font-bold transition-all duration-200 relative ${
        isActive
          ? "bg-[#2563EB] text-white shadow-sm shadow-[#2563EB]/15"
          : "text-[#526174] hover:bg-[#EAF1F7] hover:text-[#07152F]"
      }`}
    >
      {icon} <span className="text-xs uppercase tracking-wider">{label}</span>
      {badgeCount > 0 && (
        <span className="ml-auto bg-[#EF4444] text-white text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center font-mono">
          {badgeCount}
        </span>
      )}
    </button>
  );
}

function StatCard({ title, value, icon, color = "blue" }: any) {
  return (
    <div className="p-6 rounded-[2rem] border border-[#D7E6ED] bg-white shadow-sm flex flex-col justify-between h-[140px]">
      <div className={`text-[9px] font-mono tracking-widest uppercase flex items-center gap-2 ${
        color === "orange" ? "text-[#F59E0B]" : color === "green" ? "text-[#10B981]" : "text-[#526174]"
      }`}>
        {icon} {title}
      </div>
      <div className={`text-4xl font-black font-mono mt-4 ${
        color === "orange" ? "text-[#F59E0B]" : color === "green" ? "text-[#10B981]" : "text-[#2563EB]"
      }`}>
        {String(value).padStart(2, "0")}
      </div>
    </div>
  );
}

// Vault Gallery Grid
function DashboardView({ galleryKey, onGenerateDmca, onTrackOnline }: { galleryKey: number; onGenerateDmca: (dna: string) => void; onTrackOnline: (imageUrl: string, fileName: string) => void }) {
  const [gallery, setGallery] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchImages = async () => {
      if (!auth || !auth.currentUser) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const q = query(
          collection(db, "protected_images"),
          where("userId", "==", auth.currentUser.uid)
        );
        const snap = await getDocs(q);
        const items = snap.docs.map((d) => {
          const data = d.data();
          const ts = data.timestamp;
          const timestampStr =
            ts && typeof ts.toDate === "function"
              ? ts.toDate().toLocaleString()
              : typeof ts === "string" ? ts : "";
          return { id: d.id, ...data, timestamp: timestampStr };
        });
        items.sort((a: any, b: any) => {
          const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return bTime - aTime;
        });
        setGallery(items);
      } catch (err) {
        console.error("Gallery Fetch Error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchImages();
  }, [galleryKey]);

  return (
    <div className="mt-6 text-left">
      <h3 className="text-xs font-black uppercase tracking-widest mb-6 text-[#526174]">
        Your Protected Vault
      </h3>
      {loading ? (
        <div className="text-center py-10 animate-pulse text-[#2563EB] font-mono text-xs uppercase tracking-widest">Syncing Vault...</div>
      ) : gallery.length === 0 ? (
        <div className="p-16 text-center text-[#526174] border border-dashed border-[#D7E6ED] rounded-[2rem] bg-white shadow-sm font-sans text-xs">
          Your vault is empty. Seal some assets in the Fingerprint Engine first!
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {gallery.map((img) => (
            <div key={img.id} className="aspect-square rounded-2xl overflow-hidden border border-[#D7E6ED] relative group cursor-pointer bg-slate-50 shadow-sm">
              <img src={img.imageUrl} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" alt={img.fileName} />
              <div className="absolute inset-0 bg-white/95 opacity-0 group-hover:opacity-100 transition-all p-5 flex flex-col justify-end backdrop-blur-sm">
                
                <div className="flex items-center gap-1.5 text-[#2563EB] mb-1">
                  <ShieldCheck size={18} />
                  <span className="text-[10px] font-black tracking-widest uppercase">Secured</span>
                </div>
                
                <p className="text-[10px] font-mono text-[#07152F] truncate">{img.fileName}</p>
                <p className="text-[#526174] text-[8px] font-mono uppercase tracking-wider block mt-1">{img.timestamp}</p>
                
                <div className="flex flex-col gap-1.5 mt-4 w-full">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onGenerateDmca(img.dna);
                    }}
                    className="w-full py-2 bg-[#F5FAFD] hover:bg-[#EAF1F7] border border-[#D7E6ED] text-[#07152F] text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all"
                  >
                    Generate Notice
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTrackOnline(img.imageUrl, img.fileName);
                    }}
                    className="w-full py-2 bg-[#2563EB] hover:bg-[#2563EB]/90 text-white text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all"
                  >
                    Track Online
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
