/** Page content labels (settings pages) — Thai source → EN & MY */
type NavTranslation = { en: string; my: string };

export const APP_PAGE_LABELS: Record<string, NavTranslation> = {
  // My Leaves page
  "ยื่นใบลาและดูประวัติการลาของคุณ": {
    en: "Submit leave requests and view your leave history",
    my: "ခွင့်တောင်းဆိုမှုများ တင်သွင်းပြီး ခွင့်မှတ်တမ်းကြည့်ပါ",
  },
  "ยื่นใบลาใหม่": { en: "Submit New Leave", my: "ခွင့်အသစ် တင်သွင်းရန်" },
  "กรอกข้อมูลเพื่อส่งคำขอลาไปยังแผนกบุคคล": {
    en: "Fill in the information to send a leave request to HR",
    my: "HR သို့ ခွင့်တောင်းဆိုမှု ပို့ရန် အချက်အလက် ဖြည့်ပါ",
  },
  "คุณเป็นพนักงานค่าแรงรายวัน — วันลาที่อนุมัติไม่นับเป็นวันจ่ายค่าจ้าง (ไม่ใช้สิทธิ์ลาป่วย/ลากิจแบบพนักงานเงินเดือน)": {
    en: "You are a daily-wage employee — approved leave days are not paid (monthly sick/personal leave entitlements do not apply)",
    my: "သင်သည် နေ့စဉ်ခနှုန်း ဝန်ထမ်းဖြစ်သည် — အတည်ပြုခွင့်ရက်များတွင် လုပ်ခ မရပါ",
  },
  "ประเภทการลา": { en: "Leave Type", my: "ခွင့်အမျိုးအစား" },
  "เลือกประเภทการลา": { en: "Select leave type", my: "ခွင့်အမျိုးအစား ရွေးပါ" },
  "ลาครึ่งวัน (0.5 วัน)": { en: "Half-day leave (0.5 day)", my: "တစ်ဝက်ရက် ခွင့် (၀.၅ ရက်)" },
  "ช่วงเวลาที่ลา": { en: "Leave session", my: "ခွင့်ယူသည့်အချိန်" },
  "ครึ่งเช้า": { en: "Morning", my: "မနက်" },
  "ครึ่งบ่าย": { en: "Afternoon", my: "နေ့လယ်" },
  "วันเริ่มลา": { en: "Start Date", my: "စတင်ရက်" },
  "วันสิ้นสุด": { en: "End Date", my: "ပြီးဆုံးရက်" },
  "เลือกวันที่": { en: "Select date", my: "ရက်ရွေးပါ" },
  "เหตุผลการลา": { en: "Reason for Leave", my: "ခွင့်ယူသည့်အကြောင်းရင်း" },
  "ระบุเหตุผล เช่น ลาป่วยมีใบรับรองแพทย์...": {
    en: "Specify reason, e.g. sick leave with medical certificate...",
    my: "အကြောင်းရင်း ဖော်ပြပါ၊ ဥပမာ — ဆေးလက်မှတ်ပါသော ဖျားနာခွင့်...",
  },
  "แนบเอกสารการลา": { en: "Attach leave documents", my: "ခွင့်စာရွက်များ ပူးတွဲရန်" },
  "ถ่ายรูปหรือเลือกจากอัลบั้ม (สูงสุด 2 รูป) ระบบจะลดขนาดอัตโนมัติหากใหญ่กว่า ~500 KB": {
    en: "Take a photo or choose from album (max 2 photos). Auto-resized if larger than ~500 KB",
    my: "ဓာတ်ပုံရိုက် သို့မဟုတ် album မှ ရွေးပါ (အများဆုံး ၂ ပုံ) ~500 KB ထက်ကြီးပါက အလိုအလျောက် လျှော့ပေးသည်",
  },
  "ถ่ายรูป": { en: "Take Photo", my: "ဓာတ်ပုံရိုက်" },
  "อัลบั้ม": { en: "Album", my: "Album" },
  "กำลังประมวลผล...": { en: "Processing...", my: "လုပ်ဆောင်နေသည်..." },
  "ส่งคำขอลา": { en: "Submit Leave Request", my: "ခွင့်တောင်းဆိုမှု ပို့ရန်" },
  "ประวัติการลาของฉัน": { en: "My Leave History", my: "ကျွန်ုပ်၏ ခွင့်မှတ်တမ်း" },
  "รายการใบลาที่ยื่นในระบบทั้งหมด (เรียงตามล่าสุด)": {
    en: "All leave requests submitted (sorted by latest)",
    my: "တင်သွင်းထားသော ခွင့်အားလုံး (နောက်ဆုံးအရ排列)",
  },
  "วันที่ลา": { en: "Leave Date", my: "ခွင့်ရက်" },
  "ประเภท": { en: "Type", my: "အမျိုးအစား" },
  "วัน": { en: "Days", my: "ရက်" },
  "สถานะ": { en: "Status", my: "အခြေအနေ" },
  "เอกสารแนบ": { en: "Attachments", my: "ပူးတွဲဖိုင်များ" },
  "จัดการ": { en: "Actions", my: "လုပ်ဆောင်ချက်" },
  "ยังไม่มีประวัติการลา": { en: "No leave history yet", my: "ခွင့်မှတ်တမ်း မရှိသေးပါ" },
  "รูป": { en: "Photo", my: "ဓာတ်ပုံ" },
  "ยกเลิกใบลา": { en: "Cancel leave request", my: "ခွင့်တောင်းဆိုမှု ပယ်ဖျက်" },
  "ยืนยันการยกเลิกคำขอลา?": { en: "Confirm cancel leave request?", my: "ခွင့်တောင်းဆိုမှု ပယ်ဖျက်မလား?" },
  "คุณต้องการยกเลิกใบลาประเภท {type} วันที่ {date} ใช่หรือไม่?": {
    en: "Cancel {type} leave on {date}?",
    my: "{date} ရက်ရှိ {type} ခွင့်ကို ပယ်ဖျက်မလား?",
  },
  "ปิด": { en: "Close", my: "ပိတ်ရန်" },
  "ยืนยันยกเลิก": { en: "Confirm Cancel", my: "ပယ်ဖျက်မည်" },
  "จำนวนวันลาของคุณเกินสิทธิ์ที่กำหนด": {
    en: "Your leave days exceed the allowed quota",
    my: "ခွင့်ရက်များ သတ်မှတ်ထားသည်ထက် ကျော်လွန်နေသည်",
  },
  "การลาครั้งนี้จะทำให้วันลาสะสมเกินจำนวนวันที่บริษัทกำหนด คุณต้องการยืนยันการส่งใบลาต่อหรือไม่?": {
    en: "This leave will exceed your annual quota. Do you want to submit anyway?",
    my: "ဤခွင့်သည် နှစ်စဉ်ခွင့်ကို ကျော်လွန်မည်။ ဆက်လက် တင်သွင်းမလား?",
  },
  "ยกเลิก": { en: "Cancel", my: "ပယ်ဖျက်" },
  "ยืนยันส่งใบลา": { en: "Confirm Submit", my: "တင်သွင်းမည်" },
  "ต้องสร้างดัชนี (Index) ก่อน": { en: "Database index required", my: "Database index လိုအပ်သည်" },
  "ฐานข้อมูลต้องการดัชนีเพื่อจัดเรียงประวัติการลาของคุณ กรุณากดปุ่มด้านล่างเพื่อสร้าง Index": {
    en: "The database needs an index to sort your leave history. Click the button below to create it.",
    my: "ခွင့်မှတ်တမ်း စ排列ရန် database index လိုအပ်သည်။ အောက်ပါ ခလုတ်ကို နှိပ်ပါ။",
  },
  "สร้าง Index / Create Index": { en: "Create Index", my: "Index ဖန်တီးရန်" },

  // Leave types & statuses
  "ลาป่วย": { en: "Sick Leave", my: "ဖျားနာခွင့်" },
  "ลากิจ": { en: "Personal Leave", my: "ကိုယ်ရေးခွင့်" },
  "ลาพักร้อน": { en: "Vacation Leave", my: "အပန်းဖြေခွင့်" },
  "รออนุมัติ": { en: "Pending Approval", my: "အတည်ပြုရန် စောင့်ဆိုင်း" },
  "อนุมัติแล้ว": { en: "Approved", my: "အတည်ပြုပြီး" },
  "ไม่อนุมัติ": { en: "Rejected", my: "ငြင်းပယ်ခံရ" },
  "ยกเลิกแล้ว": { en: "Cancelled", my: "ပယ်ဖျက်ပြီး" },

  // Holidays page
  "วันหยุดตามประเพณีประจำปีของบริษัท": {
    en: "Annual traditional holidays of the company",
    my: "ကုမ္ပဏီ၏ နှစ်စဉ် ရုံးပိတ်ရက်များ",
  },
  "วันหยุดปี": { en: "Holidays for Year", my: "ရုံးပိတ်ရက် နှစ်" },
  "ไม่มีข้อมูลวันหยุดสำหรับปีที่เลือก": {
    en: "No holiday data for the selected year",
    my: "ရွေးချယ်ထားသော နှစ်အတွက် ရုံးပိတ်ရက် မရှိပါ",
  },

  // Common holiday names
  "วันปีใหม่": { en: "New Year's Day", my: "နှစ်သစ်ကူးနေ့" },
  "ตรุษจีน": { en: "Chinese New Year", my: "တရုတ်နှစ်သစ်ကူး" },
  "สงกรานต์": { en: "Songkran", my: "Songkran" },
  "วันแรงงานแห่งชาติ": { en: "National Labour Day", my: "အလုပ်သမားနေ့" },
  "วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว": {
    en: "King's Birthday",
    my: "King's Birthday",
  },
  "วันแม่แห่งชาติ": { en: "Mother's Day", my: "Mother's Day" },
  "วันพ่อแห่งชาติ": { en: "Father's Day", my: "Father's Day" },
  "วันแรงงาน": { en: "Labour Day", my: "အလုပ်သမားနေ့" },
  "วันหยุดราชการ": { en: "Public Holiday", my: "အများပြည်သူ ရုံးပိတ်ရက်" },

  // My Payslips page
  "ตรวจสอบสลิปเงินเดือนและกดยืนยัน": {
    en: "Review payslips and confirm",
    my: "လစာစlip စ검토ပြီး အတည်ပြုပါ",
  },
  "ประวัติสลิปเงินเดือน": { en: "Payslip History", my: "လစာစlip မှတ်တမ်း" },
  "แสดงรายการสลิปเงินเดือนล่าสุดของคุณ": {
    en: "Showing your latest payslip list",
    my: "သင်၏ နောက်ဆုံး လစာစlip စာရင်း",
  },
  "งวด": { en: "Period", my: "ကာလ" },
  "เงินสุทธิ": { en: "Net Amount", my: "အသားတင်" },
  "สถานะสลิป": { en: "Slip Status", my: "Slip အခြေအနေ" },
  "สถานะการจ่าย": { en: "Payment Status", my: "ငွေပေးချေမှု အခြေအနေ" },
  "การดำเนินการ": { en: "Actions", my: "လုပ်ဆောင်ချက်" },
  "ยังไม่มีข้อมูลสลิปเงินเดือน": { en: "No payslip data yet", my: "လစာစlip အချက်အလက် မရှိသေးပါ" },
  "บาท": { en: "THB", my: "ဘတ်" },
  "ดู": { en: "View", my: "ကြည့်ရန်" },
  "รอโอน": { en: "Pending Transfer", my: "လွှဲပို့ရန် စောင့်ဆိုင်း" },
  "จ่ายแล้ว": { en: "Paid", my: "ပေးချေပြီး" },

  // Payslip statuses
  "ฉบับร่าง": { en: "Draft", my: "Draft" },
  "ส่งให้พนักงานตรวจสอบ": { en: "Sent for Review", my: "စ검토ရန် ပို့ပြီး" },
  "ร้องขอแก้ไข": { en: "Revision Requested", my: "ပြင်ဆင်မှု တောင်းဆိုသည်" },
  "รอจ่ายเงิน": { en: "Ready to Pay", my: "ငွေပေးရန် စောင့်ဆိုင်း" },

  // Payslip dialogs & actions
  "ร้องขอแก้ไขสลิปเงินเดือน": { en: "Request Payslip Revision", my: "လစာစlip ပြင်ဆင်မှု တောင်းဆိုရန်" },
  "กรุณาระบุเหตุผลที่ต้องการแก้ไขให้ชัดเจน": {
    en: "Please clearly state the reason for revision",
    my: "ပြင်ဆင်ရခြင်း အကြောင်းရင်း ရှင်းရှင်းလင်းလင်း ဖော်ပြပါ",
  },
  "กรุณากรอกเหตุผลที่นี่...": { en: "Enter reason here...", my: "အကြောင်းရင်း ဤနေရာတွင် ရေးပါ..." },
  "ส่งคำร้อง": { en: "Submit Request", my: "တောင်းဆိုမှု ပို့ရန်" },
  "ดูสลิปเงินเดือน": { en: "View Payslip", my: "လစာစlip ကြည့်ရန်" },
  "ยอมรับ": { en: "Accept", my: "လက်ခံသည်" },

  // Profile settings page
  "จัดการข้อมูลส่วนตัวของคุณ": { en: "Manage your personal information", my: "သင်၏ ကိုယ်ရေးအချက်အလက် စီမံခန့်ခွဲရန်" },
  "แก้ไขข้อมูล": { en: "Edit Profile", my: "အချက်အလက် ပြင်ဆင်ရန်" },
  "ชื่อ-นามสกุล": { en: "Full Name", my: "အမည်" },
  "เบอร์โทรศัพท์": { en: "Phone Number", my: "ဖုန်းနံပါတ်" },
  "แผนก": { en: "Department", my: "ဌာန" },
  "ตำแหน่ง": { en: "Role", my: "ရာထူး" },
  "ที่อยู่": { en: "Address", my: "လိပ်စာ" },
  "เลขบัตรประชาชน": { en: "ID Card Number", my: "မှတ်ပုံတင်နံပါတ်" },
  "บัญชีธนาคาร": { en: "Bank Account", my: "ဘဏ်အကောင့်" },
  "ผู้ติดต่อฉุกเฉิน": { en: "Emergency Contact", my: "အရေးပေါ် ဆက်သွယ်ရန်" },
  "บันทึก": { en: "Save", my: "သိမ်းရန်" },
  "ที่อยู่และบัตรประชาชน": { en: "Address & ID Card", my: "လိပ်စာ နှင့် မှတ်ပုံတင်" },
  "บัญชีธนาคาร (สำหรับโอนเงิน)": { en: "Bank Account (for transfers)", my: "ဘဏ်အကောင့် (လွှဲပို့ရန်)" },
  "ชื่อธนาคาร": { en: "Bank Name", my: "ဘဏ်အမည်" },
  "ชื่อบัญชี": { en: "Account Name", my: "အကောင့်အမည်" },
  "เลขที่บัญชี": { en: "Account Number", my: "အကောင့်နံပါတ်" },
  "ชื่อ": { en: "Name", my: "အမည်" },
  "ความสัมพันธ์": { en: "Relationship", my: "တော်စပ်ပုံ" },
  "ข้อมูลเงินเดือน / ประกันสังคม / โรงพยาบาลประกันสังคมแก้ไขได้เฉพาะแผนกบุคคลเท่านั้น — หน้านี้ไม่แสดงและไม่บันทึกฟิลด์เหล่านั้น": {
    en: "Salary / social security / SSO hospital info can only be edited by HR — not shown or saved on this page.",
    my: "လစာ / လူမှုဖူလုံ / SSO ဆေးရုံ အချက်အလက်ကို HR မှသာ ပြင်ဆင်နိုင်သည် — ဤစာမျက်နှာတွင် မပြသပါ။",
  },
  "บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์": {
    en: "House no., street, sub-district, district, province, postal code",
    my: "အိမ်နံပါတ်၊ လမ်း၊ township၊ ခရိုင်၊ ပြည်နယ်၊ စာပို့ကုဒ်",
  },
  "13 หลัก": { en: "13 digits", my: "၁၃ လုံး" },
  "เช่น กสิกรไทย": { en: "e.g. Kasikorn Bank", my: "ဥ. Kasikorn Bank" },
  "เช่น คู่สมรส, พ่อ, แม่": { en: "e.g. spouse, father, mother", my: "ဥ. အိမ်ထောင်ဖက်၊ ဖခင်၊ မိခင်" },
};
