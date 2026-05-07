"use strict";
/** สอดคล้องกับ src/lib/customer-auth-phone และ customer-utils (ฝั่งแอป) */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePhoneDigits = normalizePhoneDigits;
exports.customerDocumentIdFromPhone = customerDocumentIdFromPhone;
exports.phoneSearchTokens = phoneSearchTokens;
function normalizePhoneDigits(s) {
    return String(s || "").replace(/\D/g, "");
}
function customerDocumentIdFromPhone(raw) {
    let d = normalizePhoneDigits(String(raw || "").trim());
    if (!d)
        return "";
    if (d.startsWith("66") && d.length >= 11) {
        d = "0" + d.slice(2);
    }
    if (!d.startsWith("0") && d.length === 9) {
        d = "0" + d;
    }
    return d;
}
function phoneSearchTokens(raw) {
    const rawTrim = String(raw || "").trim();
    const docId = customerDocumentIdFromPhone(rawTrim);
    const digits = normalizePhoneDigits(rawTrim);
    return Array.from(new Set([docId, rawTrim, digits].filter(Boolean)));
}
