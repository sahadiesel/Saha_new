import type { PublicSiteLanguage } from "@/lib/public-site-language";
import { APP_PAGE_LABELS } from "@/lib/app-page-i18n";

export type NavTranslation = { en: string; my: string };

/** Thai source label → English & Burmese */
const APP_NAV_LABELS: Record<string, NavTranslation> = {
  // Departments
  "ฝ่ายบริหาร": { en: "Management", my: "စီမံခန့်ခွဲရေး" },
  "แผนกออฟฟิศ": { en: "Office Department", my: "ရုံးဌာန" },
  "จัดซื้อ/สต๊อค": { en: "Purchasing/Stock", my: "ဝယ်ယူမှု/စတော့" },
  "แผนกบัญชี/บุคคล": { en: "Accounting/HR", my: "စာရင်းကိုင်/HR" },
  "งานซ่อมหน้าร้าน": { en: "Front Shop Repair", my: "ရှေ့ဆိုင်ပြင်ဆင်မှု" },
  "แผนกคอมมอนเรล": { en: "Common Rail Dept", my: "Common Rail ဌာန" },
  "แผนกแมคคานิค": { en: "Mechanic Dept", my: "စက်ပြင်ဌာန" },
  "งานนอก": { en: "Outsource", my: "အပြင်လုပ်ငန်း" },
  "จัดการเว็บไซต์": { en: "Web Management", my: "ဝဘ်ဆိုက်စီမံခန့်ခွဲမှု" },

  // QR attendance
  "QR ลงเวลา": { en: "QR Time Clock", my: "QR အချိန်မှတ်တမ်း" },
  "คอมกลาง (ลงเวลา)": { en: "Central PC (Clock In)", my: "အလယ်ကွန်ပျူတာ (အချိန်မှတ်)" },
  "ประวัติลงเวลา": { en: "Attendance History", my: "အချိန်မှတ်တမ်းမှတ်တမ်း" },

  // Job management
  "จัดการงานซ่อม": { en: "Repair Job Management", my: "ပြင်ဆင်မှုစီမံခန့်ခွဲမှု" },
  "งานทั้งหมด": { en: "All Jobs", my: "အလုပ်အားလုံး" },
  "งานตามแผนก": { en: "Jobs by Department", my: "ဌာနအလိုက် အလုပ်များ" },
  "งานตามสถานะ": { en: "Jobs by Status", my: "အခြေအနေအလိုက် အလုပ်များ" },
  "ประวัติงานซ่อม": { en: "Repair History", my: "ပြင်ဆင်မှုမှတ်တမ်း" },
  "งานตามพนักงาน": { en: "Jobs by Employee", my: "ဝန်ထမ်းအလိုက် အလုပ်များ" },
  "งานของฉัน": { en: "My Jobs", my: "ကျွန်ုပ်၏ အလုပ်များ" },
  "ไม่พบรายชื่อช่าง": { en: "No technicians found", my: "စက်ပြင်မတွေ့ပါ" },

  // Documents & parts
  "จัดการเอกสาร": { en: "Document Management", my: "စာရွက်စာတမ်းစီမံခန့်ခွဲမှု" },
  "รายการซื้อสินค้า": { en: "Purchase Orders", my: "ဝယ်ယူမှုစာရင်း" },
  "รายการเบิกสินค้า": { en: "Withdrawal List", my: "ထုတ်ယူမှုစာရင်း" },
  "ใบเสนอราคา": { en: "Quotation", my: "စျေးနှုန်းထုတ်ပြန်ချက်" },
  "ใบหัก ณ ที่จ่าย": { en: "Withholding Tax", my: "ကြိုတင်ခွန်" },
  "ตั้งค่า (งานอะไหล่)": { en: "Settings (Parts)", my: "ဆက်တင်များ (အစိတ်အပိုင်းများ)" },
  "จัดการรายชื่อร้านค้า": { en: "Vendor Management", my: "ဆိုင်စီမံခန့်ခွဲမှု" },
  "หมวดหมู่อะไหล่": { en: "Parts Categories", my: "အစိတ်အပိုင်းအမျိုးအစား" },
  "จัดการชั้นวางสินค้า": { en: "Shelf Management", my: "စင်စီမံခန့်ခွဲမှု" },
  "รายการและสต๊อคสินค้า": { en: "Inventory & Stock", my: "စာရင်းနှင့် စတော့" },
  "รายการที่ต้องเตรียมสั่ง": { en: "Low Stock Items", my: "မှာယူရမည့်ပစ္စည်းများ" },
  "Template ใบเสนอราคา": { en: "Quotation Templates", my: "စျေးနှုန်းကotation Templates" },

  // Accounting
  "แผนกบัญชี": { en: "Accounting", my: "စာရင်းကိုင်ဌာန" },
  "รอตรวจสอบรายการขาย": { en: "Pending Sales Review", my: "အရောင်းစာရင်းစစ်ဆေးရန်" },
  "รอตรวจสอบรายการซื้อ": { en: "Pending Purchase Review", my: "ဝယ်ယူမှုစာရင်းစစ်ဆေးရန်" },
  "รับ–จ่ายเงิน": { en: "Cash In/Out", my: "ငွေဝင်/ငွေထွက်" },
  "ลูกหนี้/เจ้าหนี้": { en: "Receivables/Payables", my: "ရရမည့်ငွေ/ပေးရမည့်ငွေ" },
  "ครบกำหนดจ่ายเครดิต": { en: "Credit Due Dates", my: "အကြွေးသတ်မှတ်ရက်" },
  "บัญชีเงินสด/ธนาคาร": { en: "Cash/Bank Accounts", my: "ငွေသား/ဘဏ်အကောင့်" },
  "จ่ายเงินเดือน": { en: "Payroll Payout", my: "လစာပေးချေမှု" },
  "เอกสารบัญชี": { en: "Accounting Documents", my: "စာရင်းကိုင်စာရွက်စာတမ်းများ" },
  "ใบส่งของชั่วคราว": { en: "Delivery Note", my: "ပို့ဆောင်မှုမှတ်တမ်း" },
  "ใบกำกับภาษี": { en: "Tax Invoice", my: "အခွန်ပေးချေမှတ်တမ်း" },
  "ใบเสร็จรับเงิน": { en: "Receipt", my: "ငွေလက်ခံဖြတ်ပိုင်း" },
  "ใบวางบิล": { en: "Billing Note", my: "ဘေလ်မှတ်တမ်း" },
  "ใบลดหนี้": { en: "Credit Note", my: "Credit Note" },
  "ใบเพิ่มหนี้": { en: "Debit Note", my: "Debit Note" },

  // HR
  "แผนกบุคคล": { en: "Human Resources", my: "HR ဌာန" },
  "จัดการพนักงาน": { en: "Employee Management", my: "ဝန်ထမ်းစီမံခန့်ခွဲမှု" },
  "จัดการวันลาพนักงาน": { en: "Leave Management", my: "ခွင့်စီမံခန့်ခွဲမှု" },
  "จัดการการลงเวลา": { en: "Attendance Management", my: "အချိန်မှတ်စီမံခန့်ခွဲမှု" },
  "สลิปเงินเดือน": { en: "Payslips", my: "လစာစလစ်များ" },
  "มีคำขอลารออนุมัติ": { en: "Pending leave requests", my: "ခွင့်တောင်းဆိုမှု ဆိုင်းငံ့" },

  // Web management
  "จัดการหน้าแรก": { en: "Homepage Management", my: "ပထမစာမျက်နှာ စီမံခန့်ခွဲမှု" },
  "จัดการหน้าสินค้า": { en: "Products Page", my: "ထုတ်ကုန်စာမျက်နှာ" },
  "จัดการหน้างานบริการ": { en: "Services Page", my: "ဝန်ဆောင်မှုစာမျက်နှာ" },

  // Admin
  "การจัดการ user ลูกค้า": { en: "Customer User Management", my: "Customer User စီမံခန့်ခွဲမှု" },
  "จัดการผู้ใช้ / Maintenance": { en: "User Management / Maintenance", my: "User စီမံခန့်ခွဲမှု / Maintenance" },
  "ประวัติสต๊อก (Activity Log)": { en: "Stock History (Activity Log)", my: "စတော့မှတ်တမ်း (Activity Log)" },

  // Settings
  "ตั้งค่า": { en: "Settings", my: "ဆက်တင်များ" },
  "ตั้งค่าร้าน/เวลา": { en: "Store/Time Settings", my: "ဆိုင်/အချိန် ဆက်တင်များ" },
  "ตั้งค่าเลขที่เอกสาร": { en: "Document Number Settings", my: "စာရွက်နံပါတ် ဆက်တင်များ" },
  "ตั้งค่า HR": { en: "HR Settings", my: "HR ဆက်တင်များ" },
  "รพ. ประกันสังคม": { en: "SSO Hospitals", my: "လူမှုဖူလုံရေး ဆေးရုံ" },
  "ตั้งค่าวันหยุด": { en: "Holiday Settings", my: "ရုံးပိတ်ရက် ဆက်တင်များ" },

  // Office
  "แดชบอร์ด": { en: "Dashboard", my: "Dashboard" },
  "เปิดงานใหม่ (Intake)": { en: "New Job (Intake)", my: "အလုပ်အသစ် (Intake)" },
  "ค้นหาสินค้า": { en: "Search Products", my: "ထုတ်ကုန်ရှာဖွေ" },
  "การจัดการรายชื่อ": { en: "List Management", my: "စာရင်းစီမံခန့်ခွဲမှု" },
  "จัดการรายชื่อลูกค้า": { en: "Customer Management", my: "ဖောက်သည်စီမံခန့်ခွဲမှု" },
  "เงินสดหน้าร้าน": { en: "Front Cash Drawer", my: "ရှေ့ဆိုင်ငွေသား" },

  // Outsource
  "สร้างรายการส่งออก": { en: "Create Export", my: "တင်ပို့မှုဖန်တီး" },
  "รับกลับเข้าระบบ": { en: "Import Return", my: "ပြန်လည်သွင်းယူ" },
  "ติดตาม": { en: "Tracking", my: "ခြေရာခံ" },
  "รอส่ง": { en: "Pending Send", my: "ပို့ရန်ဆိုင်းငံ့" },
  "อยู่ร้านนอก": { en: "At External Shop", my: "ပြင်ပဆိုင်တွင်" },
  "รับกลับแล้ว": { en: "Returned", my: "ပြန်လည်ရောက်ရှိ" },

  // Profile menu
  "โปรไฟล์และการตั้งค่า": { en: "Profile & Settings", my: "Profile နှင့် Settings" },
  "ใบลาของฉัน": { en: "My Leaves", my: "ကျွန်ုပ်၏ ခွင့်များ" },
  "ปฏิทินวันหยุด": { en: "Holiday Calendar", my: "ရုံးပိတ်ရက်ပြက္ခဒိန်" },
  "ใบเงินเดือนของฉัน": { en: "My Payslips", my: "ကျွန်ုပ်၏ လစာစလစ်" },
  "กลับสู่หน้าแรก": { en: "Back to Home", my: "ပထမစာမျက်နှာသို့" },
};

const ALL_APP_LABELS: Record<string, NavTranslation> = {
  ...APP_NAV_LABELS,
  ...APP_PAGE_LABELS,
};

export function translateAppNavLabel(
  thaiLabel: string,
  lang: PublicSiteLanguage
): string {
  if (lang === "th") return thaiLabel;
  const entry = ALL_APP_LABELS[thaiLabel];
  if (!entry) return thaiLabel;
  return entry[lang];
}
