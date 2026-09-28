// แปลงข้อความที่วางมา (คัดลอกจาก Excel หรือ CSV) เป็นรายชื่อนักเรียน
// ลำดับคอลัมน์: เลขที่, รหัสประจำตัว, คำนำหน้า, ชื่อ, นามสกุล
export function parseStudentRows(text) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows = [];
  const errors = [];
  const seen = new Set();

  lines.forEach((line, i) => {
    const sep = line.includes("\t") ? "\t" : ",";
    const cols = line.split(sep).map((c) => c.trim());

    // ข้ามแถวหัวตาราง (ถ้าคอลัมน์แรกไม่ใช่ตัวเลข)
    if (i === 0 && isNaN(Number(cols[0]))) return;

    const [no, studentCode, prefix, firstName, lastName] = cols;

    if (!studentCode || !firstName) {
      errors.push(`บรรทัดที่ ${i + 1}: ข้อมูลไม่ครบ (ต้องมีรหัสประจำตัวและชื่อ)`);
      return;
    }
    if (studentCode.includes("/")) {
      errors.push(`บรรทัดที่ ${i + 1}: รหัสประจำตัวห้ามมีเครื่องหมาย /`);
      return;
    }
    if (seen.has(studentCode)) {
      errors.push(`บรรทัดที่ ${i + 1}: รหัส ${studentCode} ซ้ำกับบรรทัดก่อนหน้า`);
      return;
    }
    seen.add(studentCode);

    rows.push({
      no: Number(no) || 0,
      studentCode,
      prefix: prefix || "",
      firstName,
      lastName: lastName || "",
    });
  });

  return { rows, errors };
}