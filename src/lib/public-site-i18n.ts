import type { NavTranslation } from "@/lib/app-nav-i18n";

/** Public marketing site labels — Thai source → EN & MY */
export const PUBLIC_SITE_LABELS: Record<string, NavTranslation> = {
  // Navigation
  "หน้าแรก": { en: "Home", my: "ပထမစာမျက်နှာ" },
  "สินค้าและอะไหล่": { en: "Products & Parts", my: "ထုတ်ကုန်နှင့် အစိတ်အပိုင်းများ" },
  "งานบริการ": { en: "Services", my: "ဝန်ဆောင်မှုများ" },
  "ติดต่อเรา": { en: "Contact Us", my: "ဆက်သွယ်ရန်" },

  // Auth / header
  "ลงชื่อเข้าใช้": { en: "Sign In", my: "ဝင်ရောက်ရန်" },
  "สำหรับพนักงาน (Staff)": { en: "For Staff", my: "Staff အတွက်" },
  "สำหรับลูกค้า (Customer)": { en: "For Customers", my: "Customer အတွက်" },
  "เข้าใช้โดย:": { en: "Signed in as:", my: "ဝင်ရောက်ထားသူ:" },
  "หน้าหลักของฉัน": { en: "My Dashboard", my: "ကျွန်ုပ်၏ Dashboard" },
  "ออกจากระบบ": { en: "Sign Out", my: "ထွက်ရန်" },
  "เมนูหลัก": { en: "Main Menu", my: "မူလမီနူး" },
  "ภาษา": { en: "Language", my: "ဘာသာစကား" },
  "ลงชื่อเข้าใช้ (พนักงาน)": { en: "Sign In (Staff)", my: "ဝင်ရောက်ရန် (Staff)" },
  "ลงชื่อเข้าใช้ (ลูกค้า)": { en: "Sign In (Customer)", my: "ဝင်ရောက်ရန် (Customer)" },

  // Landing hero & CTA
  "ตรวจสอบสถานะรถ": { en: "Check Vehicle Status", my: "ယာဉ်အခြေအနေ စစ်ဆေးရန်" },
  "นัดหมายบริการ": { en: "Book a Service", my: "ဝန်ဆောင်မှု ချိန်းဆိုရန်" },
  "SAHADIESEL บริการแบบ 4S": { en: "SAHADIESEL 4S Service", my: "SAHADIESEL 4S ဝန်ဆောင်မှု" },

  // Default landing descriptions
  "ศูนย์บริการรถยนต์ครบวงจรที่มีมาตรฐานและเครื่องมือครบครัน พร้อมเครื่องวิเคราะห์รถยนต์ที่ทันสมัย ให้บริการเช็คระยะ ซ่อมเครื่องยนต์และระบบไฟฟ้า ซ่อมบำรุงรถยนต์นำเข้าได้หลากรุ่น หลายแบรนด์ โดยทีมช่างมากประสบการณ์ และมีระบบออนไลน์ในการติดตามงาน ซึ่งลูกค้าสามารถตรวจสอบสถานะการซ่อมได้ตลอดเวลา": {
    en: "Full-service automotive center with modern diagnostics. Periodic maintenance, engine and electrical repair, multi-brand imported vehicles, experienced technicians, and online repair tracking anytime.",
    my: "ခေတ်မီယာဉ်စစ်ဆေးမှုဖြင့် ယာဉ်ဝန်ဆောင်မှုစင်တာ — ပြုပြင်မှု၊ ထိန်းသိမ်းမှု၊ အွန်လိုင်းခြေရာခံနိုင်သည်။",
  },
  "ดูแลรถของคุณด้วยมืออาชีพที่เข้าใจระบบดีเซลอย่างแท้จริง หจก.สหดีเซลกลการ พร้อมให้บริการซ่อมบำรุงรักษาแบบครบวงจร ตั้งแต่รถกระบะ รถใช้งาน ไปจนถึงรถบรรทุกขนาดใหญ่ ศูนย์ซ่อมปั๊มและหัวฉีดมาตรฐาน: การันตีอะไหล่แท้จาก DENSO, BOSCH และ DELPHI บริการงานซ่อมทั่วไป: ดูแลเครื่องยนต์ เกียร์ ช่วงล่าง ระบบเบรก ด้วยทีมช่างเฉพาะทาง บำรุงรักษาเชิงป้องกัน: บริการถ่ายน้ำมันเครื่อง ฟอกเกียร์ และฟอกระบบแอร์ด้วยเครื่องมือทันสมัย เราไม่ได้แค่ซ่อม แต่เราดูแลด้วยความจริงใจ เพื่อให้รถทุกคันของลูกค้าพร้อมลุยงานได้อย่างเต็มประสิทธิภาพ": {
    en: "Professional diesel specialists at Sahadiesel Krung Karn Co., Ltd. Full maintenance from pickups to heavy trucks. Genuine DENSO, BOSCH and DELPHI parts. Engine, transmission, suspension and brake service. Preventive care with modern tools — we repair with care so your fleet stays ready.",
    my: "ဒီဇယ်စနစ်ကို နားလည်သော ကျွမ်းကျင်ပညာရှင်များဖြင့် ယာဉ်စောင့်ရှောက်မှု — pickup မှ heavy truck အထိ၊ DENSO/BOSCH/DELPHI genuine parts၊ engine/gear/brake service၊ preventive maintenance။",
  },
  "บริการมาตรฐานสากล ใส่ใจทุกขั้นตอนการตรวจเช็คและซ่อมบำรุง": {
    en: "International standards with care at every inspection and repair step.",
    my: "နိုင်ငံတကာ standard — စစ်ဆေးမှု/ပြုပြင်မှု အဆင့်တိုင်း ဂရုစိုက်သည်။",
  },
  "ให้บริการบนพื้นที่กว้างขวาง รองรับรถได้มากกว่า 50 คันต่อวัน พร้อมห้องรับรองลูกค้า": {
    en: "Spacious facility handling 50+ vehicles daily with customer lounge.",
    my: "ယာဉ် ၅၀+ / ရက် — customer lounge ပါဝင်သည်။",
  },
  "ทีมช่างผู้เชี่ยวชาญเฉพาะทาง แก้ปัญหาได้ตรงจุด รวดเร็ว แม่นยำ ด้วยระบบวิเคราะห์อัจฉริยะ": {
    en: "Specialist technicians — fast, accurate diagnostics and repair.",
    my: "အထူးကျွမ်းကျင်ပညာရှင်များ — မြန်ဆန်၊ တိကျသော diagnosis။",
  },
  "ศูนย์บริการรถยนต์นำเข้าและปั๊มหัวฉีดแบบครบวงจร One Stop Service ครอบคลุมแบบ 360 องศา ดูแลรักษา ซ่อม ทำสี เคลมประกัน ครบจบในที่เดียว": {
    en: "One-stop import vehicle and injector service — maintenance, repair, paint and insurance claims.",
    my: "One-stop import vehicle & injector service — maintenance, repair, paint, insurance။",
  },

  // Footer
  "เกี่ยวกับเรา": { en: "About Us", my: "ကျွန်ုပ်တို့အကြောင်း" },
  "Sahadiesel Service Center ผู้เชี่ยวชาญด้านการซ่อมบำรุงรถยนต์และระบบปั๊มหัวฉีดคอมมอนเรล ด้วยประสบการณ์กว่า 20 ปี เรามุ่งมั่นส่งมอบบริการที่ดีที่สุดให้กับลูกค้าทุกท่าน": {
    en: "Sahadiesel Service Center — 20+ years of automotive and common-rail injector expertise, committed to the best service.",
    my: "Sahadiesel Service Center — ယာဉ်နှင့် common-rail injector အတွေ့အကြုံ ၂၀+ နှစ်။",
  },
  "Sahadiesel Service Center ผู้เชี่ยวชาญด้านการซ่อมบำรุงรถยนต์และระบบปั๊มหัวฉีดคอมมอนเรล": {
    en: "Sahadiesel Service Center — automotive and common-rail injector specialists.",
    my: "Sahadiesel Service Center — ယာဉ်နှင့် common-rail injector specialist။",
  },
  "ติดตามเรา": { en: "Follow Us", my: "လိုက်နာပါ" },

  // Services page
  "งานบริการ (Our Services)": { en: "Our Services", my: "ဝန်ဆောင်မှုများ" },
  "หน้านี้กำลังอยู่ระหว่างการปรับปรุงข้อมูลค่ะ": {
    en: "This page is being updated.",
    my: "ဤစာမျက်နှာ ပြင်ဆင်နေပါသည်။",
  },
  "เรากำลังจัดเตรียมรายละเอียดงานบริการ ทั้งงานซ่อมบำรุงรถยนต์นำเข้า งานซ่อมปั๊มหัวฉีดคอมมอนเรล และขั้นตอนมาตรฐาน 4S เพื่อให้ท่านได้รับข้อมูลที่ครบถ้วนที่สุด": {
    en: "We are preparing service details — import vehicle repair, common-rail injectors, and 4S standards.",
    my: "import vehicle repair၊ common-rail injector၊ 4S standard အချက်အလက် ပြင်ဆင်နေပါသည်။",
  },
  "กลับสู่หน้าหลัก": { en: "Back to Home", my: "ပထမစာမျက်နှာသို့" },

  // Contact page
  "ติดต่อเรา (Contact Us)": { en: "Contact Us", my: "ဆက်သွယ်ရန်" },
  "ข้อมูลการติดต่อและสถานที่ตั้งร้าน Sahadiesel Service Center": {
    en: "Contact details and Sahadiesel Service Center location",
    my: "Sahadiesel Service Center ဆက်သွယ်ရန် အချက်အလက်",
  },
  "ข้อมูลการติดต่อและสถานที่ตั้ง": {
    en: "Contact & Location",
    my: "ဆက်သွယ်ရန် & တည်နေရာ",
  },
  "เปิดใน Google Maps": { en: "Open in Google Maps", my: "Google Maps တွင် ဖွင့်ရန်" },
  "เบอร์โทรศัพท์": { en: "Phone", my: "ဖုန်း" },
  "หจก. สหดีเซลกลการ (Sahadiesel Service Center)": {
    en: "Sahadiesel Krung Karn Co., Ltd. (Sahadiesel Service Center)",
    my: "Sahadiesel Krung Karn Co., Ltd. (Sahadiesel Service Center)",
  },

  // Products page (header)
  "เลือกชมรายการอะไหล่มาตรฐาน Sahadiesel ในราคาพิเศษ": {
    en: "Browse Sahadiesel standard parts at special prices",
    my: "Sahadiesel standard parts — special price ဖြင့်",
  },
  "ดูรายการได้โดยไม่ต้องล็อกอิน —": {
    en: "Browse without signing in —",
    my: "login မလိုဘဲ ကြည့်နိုင်သည် —",
  },
  "เข้าสู่ระบบลูกค้า": { en: "Customer Sign In", my: "Customer ဝင်ရောက်ရန်" },
  "เพื่อใส่ตะกร้าและสั่งซื้อ": {
    en: "to add to cart and order",
    my: "cart ထည့်/မှာယူရန်",
  },
};
