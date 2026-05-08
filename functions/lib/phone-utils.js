"use strict";
/** สอดคล้องกับ src/lib/customer-auth-phone และ customer-utils (ฝั่งแอป) */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePhoneDigits = normalizePhoneDigits;
exports.customerDocumentIdFromPhone = customerDocumentIdFromPhone;
exports.phoneSearchTokens = phoneSearchTokens;
exports.customerAuthEmailFromDocId = customerAuthEmailFromDocId;
exports.dedupePhoneList = dedupePhoneList;
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
/** ต้องตรงกับ src/lib/customer-auth-phone.ts */
function customerAuthEmailFromDocId(customerDocId) {
    const safe = normalizePhoneDigits(customerDocId);
    return `cust_${safe}@customer.sahadiesel.local`;
}
function dedupePhoneList(phones) {
    const seen = new Set();
    const out = [];
    for (const raw of phones) {
        const t = String(raw || "").trim();
        if (!t)
            continue;
        const k = normalizePhoneDigits(t);
        if (!k || seen.has(k))
            continue;
        seen.add(k);
        out.push(t);
    }
    return out;
}
