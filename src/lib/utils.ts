import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Recursively removes undefined values from an object or array.
 * This is useful for preparing data to be sent to Firestore, which
 * does not allow `undefined` field values.
 * 
 * Updated to safely ignore Firestore internal objects like FieldValues and Timestamps.
 * @param data The data to sanitize.
 * @returns A new object or array with all `undefined` values removed.
 */
export function sanitizeForFirestore(data: any): any {
  if (Array.isArray(data)) {
    return data
      .map(v => sanitizeForFirestore(v))
      .filter(v => v !== undefined);
  }
  
  if (data !== null && typeof data === 'object') {
    // Skip sanitization for Date, Timestamp, or other non-plain objects (like Firestore FieldValues)
    const isPlainObject = Object.getPrototypeOf(data) === Object.prototype;
    const isTimestamp = typeof data.toDate === 'function';
    
    if (!isPlainObject || isTimestamp || data instanceof Date) {
      return data;
    }

    return Object.entries(data).reduce((acc, [key, value]) => {
      if (value !== undefined) {
        const sanitizedValue = sanitizeForFirestore(value);
        if (sanitizedValue !== undefined) {
          acc[key] = sanitizedValue;
        }
      }
      return acc;
    }, {} as {[key: string]: any});
  }
  
  return data;
}

/**
 * Converts a number to Thai Baht text.
 */
export function thaiBahtText(amount: number): string {
  if (isNaN(amount) || amount === null) return "";
  
  const text_numbers = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
  const text_units = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];
  
  const [intPart, decimalPart] = amount.toFixed(2).split(".");
  
  let bahtText = "";
  
  if (parseInt(intPart) === 0) {
    bahtText = "ศูนย์";
  } else {
    const reverseInt = intPart.split("").reverse();
    for (let i = 0; i < reverseInt.length; i++) {
      const n = parseInt(reverseInt[i]);
      const unitIndex = i % 6;
      
      if (unitIndex === 0 && i > 0) bahtText = "ล้าน" + bahtText;
      
      if (n !== 0) {
        let currentText = text_numbers[n];
        let currentUnit = text_units[unitIndex];
        
        if (unitIndex === 1 && n === 1) currentText = "";
        if (unitIndex === 1 && n === 2) currentText = "ยี่";
        if (unitIndex === 0 && n === 1 && i > 0 && reverseInt.length > 1) currentText = "เอ็ด";
        
        bahtText = currentText + currentUnit + bahtText;
      }
    }
  }
  
  bahtText += "บาท";
  
  if (parseInt(decimalPart) === 0) {
    bahtText += "ถ้วน";
  } else {
    const reverseDec = decimalPart.split("").reverse();
    let satangText = "";
    for (let i = 0; i < reverseDec.length; i++) {
      const n = parseInt(reverseDec[i]);
      if (n !== 0) {
        let currentText = text_numbers[n];
        let currentUnit = text_units[i];
        
        if (i === 1 && n === 1) currentText = "";
        if (i === 1 && n === 2) currentText = "ยี่";
        if (i === 0 && n === 1 && decimalPart.length > 1 && parseInt(decimalPart[0]) > 0) currentText = "เอ็ด";
        
        satangText = currentText + currentUnit + satangText;
      }
    }
    bahtText += satangText + "สตางค์";
  }
  
  return "(" + bahtText + ")";
}
