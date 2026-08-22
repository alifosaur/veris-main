// hooks/useAssetTracker.ts
// NEW FEATURE: Tracks your sealed images across the web using Google Vision API
// Add this hook to your project and call it from the Alerts tab or a new "Tracker" tab.
//
// Setup:
// 1. Get a Google Cloud API key with Vision API enabled
// 2. Add to your .env.local: NEXT_PUBLIC_GOOGLE_VISION_KEY=your_key_here
// 3. Import and use this hook in your page.tsx

import { useState } from "react";
import { auth, db } from "./app/firebase"; // Adjust the path based on your project structure
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

interface TrackResult {
  imageUrl: string;
  pageUrl: string;
  matchScore: number;
  flagged: boolean;
}

export function useAssetTracker() {
  const [tracking, setTracking] = useState(false);
  const [trackResults, setTrackResults] = useState<TrackResult[]>([]);
  const [error, setError] = useState("");

  /**
   * trackImage — sends your Firebase-stored image URL to Google Vision API
   * to find matching copies on the internet.
   *
   * @param imageUrl  — the Firebase Storage URL of your sealed asset
   * @param fileName  — original filename (for alert records)
   */
  const trackImage = async (imageUrl: string, fileName: string) => {
    setTracking(true);
    setError("");
    setTrackResults([]);

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_VISION_KEY;
    if (!apiKey) {
      setError("Google Vision API key not configured. Add NEXT_PUBLIC_GOOGLE_VISION_KEY to .env.local");
      setTracking(false);
      return;
    }

    try {
      // Step 1: Call Google Vision Web Detection API
      const visionRes = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [
              {
                image: { source: { imageUri: imageUrl } },
                features: [
                  { type: "WEB_DETECTION", maxResults: 20 },
                ],
              },
            ],
          }),
        }
      );

      const visionData = await visionRes.json();
      const webDetection = visionData.responses?.[0]?.webDetection;

      if (!webDetection) {
        setTrackResults([]);
        setTracking(false);
        return;
      }

      const results: TrackResult[] = [];

      // Step 2: Parse full matching pages
      const pages = webDetection.pagesWithMatchingImages || [];
      for (const page of pages) {
        results.push({
          imageUrl: page.fullMatchingImages?.[0]?.url || imageUrl,
          pageUrl: page.url,
          matchScore: 1.0,
          flagged: true, // Full match = possible infringement
        });
      }

      // Step 3: Parse partial matches (lower priority)
      const partialPages = webDetection.partialmatchingPages || [];
      for (const page of partialPages) {
        results.push({
          imageUrl: page.url,
          pageUrl: page.url,
          matchScore: 0.7,
          flagged: false,
        });
      }

      setTrackResults(results);

      // Step 4: Log flagged results as threats in Firestore
      if (auth.currentUser && results.some((r) => r.flagged)) {
        for (const result of results.filter((r) => r.flagged)) {
          await addDoc(collection(db, "alerts"), {
            userId: auth.currentUser.uid,
            type: "threat",
            message: `Possible unauthorized use of "${fileName}" found at: ${result.pageUrl}`,
            fileName,
            infringingUrl: result.pageUrl,
            matchScore: result.matchScore,
            timestamp: serverTimestamp(),
          });
        }
      }
    } catch (err: any) {
      setError(`Tracking failed: ${err.message}`);
    } finally {
      setTracking(false);
    }
  };

  return { trackImage, tracking, trackResults, error };
}

// ─────────────────────────────────────────────────────────────────
// HOW TO USE IN page.tsx:
//
// 1. Import at the top:
//    import { useAssetTracker } from "./hooks/useAssetTracker";
//
// 2. Inside your component:
//    const { trackImage, tracking, trackResults, error } = useAssetTracker();
//
// 3. In your DashboardView vault grid, add a "Track" button on each image card:
//    <button onClick={() => trackImage(img.imageUrl, img.fileName)}>
//      Track Online
//    </button>
//
// 4. Show trackResults in a modal or a new panel below the vault.
// ─────────────────────────────────────────────────────────────────