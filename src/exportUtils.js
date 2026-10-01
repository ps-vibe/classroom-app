import * as XLSX from "xlsx";

function downloadSheet(rows, sheetName, fileName) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

// ส่งออกคะแนนทุกใบงานของวิชา 1 วิชา เป็นตารางเดียว (แถว = นักเรียน, คอลัมน์ = ใบงาน)
export function exportSubjectScores(subjectName, students, assignments, scoreByKey) {
  const rows = students.map((s) => {
    const row = {
      เลขที่: s.no,
      รหัสประจำตัว: s.studentCode,
      "ชื่อ-นามสกุล": `${s.prefix}${s.firstName} ${s.lastName}`,
    };
    assignments.forEach((a) => {
      const key = `${a.id}_${s.id}`;
      const sc = scoreByKey[key];
      row[`${a.title} (เต็ม ${a.maxScore})`] = sc?.score ?? "";
    });
    return row;
  });
  downloadSheet(rows, subjectName.slice(0, 31), `คะแนน_${subjectName}.xlsx`);
}

// ส่งออกสรุปการเข้าเรียนของวิชา 1 วิชา
export function exportAttendanceSummary(subjectName, rows, totalSessions) {
  const data = rows.map((r) => ({
    เลขที่: r.no,
    "ชื่อ-นามสกุล": `${r.prefix}${r.firstName} ${r.lastName}`,
    สาย: r.late,
    ลา: r.leave,
    ขาด: r.absent,
    "มาเรียน/ทั้งหมด": `${r.present}/${totalSessions}`,
    เปอร์เซ็นต์: r.percent,
  }));
  downloadSheet(data, "สรุปการเข้าเรียน", `การเข้าเรียน_${subjectName}.xlsx`);
}