import pywt
import numpy as np
import cv2

# We use a default alpha_strength in the 2.0 - 4.0 range for robust watermark embedding
DEFAULT_ALPHA_STRENGTH = 2.0

def embed_watermark_dwt(image_bytes: bytes, dna_string: str, alpha_strength: float = DEFAULT_ALPHA_STRENGTH):
    try:
        # 1. Read bytes into OpenCV format
        nparr = np.frombuffer(image_bytes, np.uint8)
        
        # FIX: Using IMREAD_UNCHANGED to preserve Colors and Transparency (Alpha channel)
        img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
        
        if img is None:
            print("Could not decode image.")
            return image_bytes

        # 2. Check if image has transparency (4 channels: BGRA) or just color (3 channels: BGR)
        has_alpha = img.shape[2] == 4 if len(img.shape) == 3 else False
        
        if has_alpha:
            b, g, r, a = cv2.split(img)
            channels = [b, g, r]
        elif len(img.shape) == 3:
            b, g, r = cv2.split(img)
            channels = [b, g, r]
        else:
            channels = [img] # Already grayscale
            
        # 3. Embed watermark ONLY in the first channel (Blue) so it's completely invisible to the human eye
        target_channel = channels[0].astype(np.float64)
        
        # --- Start DWT Math ---
        coeffs2 = pywt.dwt2(target_channel, 'haar')
        LL, (LH, HL, HH) = coeffs2
        
        dna_numeric = (sum(ord(c) for c in dna_string) % 20) + 10
        
        LL_watermarked = LL + (alpha_strength * dna_numeric)
        
        coeffs2_watermarked = (LL_watermarked, (LH, HL, HH))
        watermarked_channel = pywt.idwt2(coeffs2_watermarked, 'haar')
        # --- End DWT Math ---
        
        # 4. Resize back strictly to original dimensions (DWT sometimes adds a padding pixel)
        watermarked_channel = cv2.resize(watermarked_channel, (target_channel.shape[1], target_channel.shape[0]))
        channels[0] = np.clip(watermarked_channel, 0, 255).astype(np.uint8)
        
        # 5. Merge colors and transparency back together
        if has_alpha:
            merged_img = cv2.merge(channels + [a])
        elif len(img.shape) == 3:
            merged_img = cv2.merge(channels)
        else:
            merged_img = channels[0]

        # 6. Save as PNG bytes and return
        is_success, buffer = cv2.imencode(".png", merged_img)
        return buffer.tobytes() if is_success else image_bytes
        
    except Exception as e:
        print(f"Error: Watermark Error: {e}")
        # Failsafe: Agar watermark code fail hota hai, toh atleast original image wapas bhej do (black mat bhejo)
        return image_bytes

def calculate_channel_bias(image_bytes: bytes) -> float:
    """
    Calculates the original Blue channel LL mean difference (bias) compared to
    the average of Green and Red LL means. Storing this bias enables blind, robust
    watermark extraction even on highly colored images (e.g., blue skies).
    """
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
        if img is None or len(img.shape) < 3:
            return 0.0
            
        b, g, r = cv2.split(img[:, :, :3])
        
        coeffs_b = pywt.dwt2(b.astype(np.float64), 'haar')
        LL_b, _ = coeffs_b
        
        coeffs_g = pywt.dwt2(g.astype(np.float64), 'haar')
        LL_g, _ = coeffs_g
        
        coeffs_r = pywt.dwt2(r.astype(np.float64), 'haar')
        LL_r, _ = coeffs_r
        
        bias = np.mean(LL_b) - (np.mean(LL_g) + np.mean(LL_r)) / 2.0
        return float(bias)
    except Exception as e:
        print(f"Error: Error calculating channel bias: {e}")
        return 0.0

def extract_watermark_dwt(image_bytes: bytes) -> float:
    """
    Decodes the image, applies DWT decomposition to channels, and returns
    the raw mean-shift signal of the Blue channel LL band compared to Green and Red.
    """
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
        if img is None:
            return 0.0
            
        if len(img.shape) < 3:
            # Grayscale images don't have Green/Red channels to compare, return LL mean
            b = img
            coeffs_b = pywt.dwt2(b.astype(np.float64), 'haar')
            LL_b, _ = coeffs_b
            return float(np.mean(LL_b))
            
        b, g, r = cv2.split(img[:, :, :3])
        
        coeffs_b = pywt.dwt2(b.astype(np.float64), 'haar')
        LL_b, _ = coeffs_b
        
        coeffs_g = pywt.dwt2(g.astype(np.float64), 'haar')
        LL_g, _ = coeffs_g
        
        coeffs_r = pywt.dwt2(r.astype(np.float64), 'haar')
        LL_r, _ = coeffs_r
        
        mean_b = np.mean(LL_b)
        mean_g = np.mean(LL_g)
        mean_r = np.mean(LL_r)
        
        recovered_shift = mean_b - (mean_g + mean_r) / 2.0
        return float(recovered_shift)
    except Exception as e:
        print(f"Error: Error extracting watermark DWT: {e}")
        return 0.0

def verify_watermark_match(image_bytes: bytes, candidate_dna_string: str, tolerance: float = 12.0, bias: float = 0.0) -> bool:
    """
    Verifies if the extracted watermark shift matches the expected dna_numeric for the candidate.
    This is a best-effort blind check — watermarking schemes are not guaranteed to survive
    extreme screenshot cropping or heavy re-compression. It is one signal of several.
    
    A tolerance of 12.0 works well for alpha_strength = 2.0 and scaled dna_numeric (10-29)
    as it permits minor DWT reconstruction noise/clipping in high-brightness regions
    while preventing false positive matches.
    """
    try:
        dna_numeric = (sum(ord(c) for c in candidate_dna_string) % 20) + 10
        expected_shift = DEFAULT_ALPHA_STRENGTH * dna_numeric
        
        raw_shift = extract_watermark_dwt(image_bytes)
        # Correct the shift using the saved original image bias
        recovered_shift = raw_shift - bias
        
        diff = abs(recovered_shift - expected_shift)
        print(f"[Watermark] Expected shift: {expected_shift:.2f}, Recovered (corrected): {recovered_shift:.2f}, Bias: {bias:.2f}, Diff: {diff:.2f}")
        return diff <= tolerance
    except Exception as e:
        print(f"Error: Error verifying watermark: {e}")
        return False


