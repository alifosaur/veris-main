from PIL import Image, ExifTags
import io

def analyze(image_bytes: bytes):
    try:
        img = Image.open(io.BytesIO(image_bytes))
        exif_data = img.getexif()
        
        report = {
            "software": "Clean (No EXIF signature)",
            "camera_model": "Unknown",
            "is_suspicous": False
        }

        if not exif_data:
            return report

        for tag_id, value in exif_data.items():
            tag = ExifTags.TAGS.get(tag_id, tag_id)
            if tag == "Software":
                val_str = str(value).lower()
                report["software"] = str(value)
                # Flag known editing/AI software
                if any(x in val_str for x in ["adobe", "photoshop", "gimp", "midjourney", "dall-e"]):
                    report["is_suspicous"] = True
            elif tag == "Model":
                report["camera_model"] = str(value)

        return report
    except Exception as e:
        return {"error": f"Metadata extraction failed: {str(e)}"}