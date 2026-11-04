// src/examBank/ImportExamBank.jsx
// นำเข้า ExamBank_v1_pilot.xlsx -> Firestore (ครั้งเดียว/นำเข้าซ้ำได้)
import { useState } from "react";
import * as XLSX from "xlsx";
import { db } from "https://firebase.google.com/docs/web/setup#available-libraries"; // ถ้าไฟล์ firebase ของคุณอยู่ที่อื่น ให้แก้บรรทัดนี้บรรทัดเดียว
import { doc, writeBatch, serverTimestamp } from "firebase/firestore";

// รหัสเอกสารใน Firestore ห้ามมี "/" จึงแปลงรหัสตัวชี้วัด เช่น "ค 1.1 ม.4/1" -> "ค-1.1-ม.4_1"
const safeId = (s) => String(s).trim().replace(/\//g, "_").replace(/\s+/g, "-");
const clean = (v) => (v === undefined || v === null ? "" : String(v).trim());
const list = (v) => clean(v).split(/[;,]/).map((x) => x.trim()).filter(Boolean);
const TYPE = { "ปรนัย 4 ตัวเลือก": "mc4", "ปรนัย 5 ตัวเลือก": "mc5", "เติมคำตอบ": "fill", "แสดงวิธีทำ": "written" };

// ตัดคำว่า "(เสนอ)" ออกจากหัวคอลัมน์ เพื่อให้ครูเปลี่ยนชื่อหัวคอลัมน์ภายหลังได้
const norm = (row) => {
  const o = {};
  Object.keys(row).forEach((k) => (o[k.replace(/\s*\(เสนอ\)/g, "").trim()] = row[k]));
  return o;
};
const rows = (wb, name) =>
  wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" }).map(norm) : [];

function build(wb) {
  const byUnit = {};
  rows(wb, "หน่วย-ตัวชี้วัด").forEach((r) => {
    (byUnit[clean(r["รหัสหน่วย"])] ||= []).push(clean(r["รหัสตัวชี้วัด"]));
  });
  return {
    eb_courses: rows(wb, "วิชา-รายวิชา").map((r) => ({
      id: safeId(r["รหัสรายวิชา"]),
      data: { code: clean(r["รหัสรายวิชา"]), subject: clean(r["วิชาในคลัง"]), level: clean(r["ชั้น"]),
              term: Number(r["ภาคเรียน"]) || null, track: clean(r["ประเภท"]) },
    })),
    eb_indicators: rows(wb, "ตัวชี้วัด").map((r) => ({
      id: safeId(r["รหัสตัวชี้วัด"]),
      data: { code: clean(r["รหัสตัวชี้วัด"]), kind: clean(r["ประเภท"]), courseCode: clean(r["รหัสรายวิชา"]),
              standardCode: clean(r["มาตรฐาน/สาระ (รหัส)"]), standardText: clean(r["มาตรฐาน/สาระ (ข้อความ)"]),
              text: clean(r["ตัวชี้วัด/ผลการเรียนรู้ (ข้อความ)"]) },
    })),
    eb_units: rows(wb, "หน่วย").map((r) => ({
      id: safeId(r["รหัสหน่วย"]),
      data: { code: clean(r["รหัสหน่วย"]), courseCode: clean(r["รหัสรายวิชา"]), order: Number(r["ลำดับหน่วย"]) || 0,
              name: clean(r["ชื่อหน่วยการเรียนรู้"]), indicatorCodes: byUnit[clean(r["รหัสหน่วย"])] || [] },
    })),
    eb_topics: rows(wb, "เรื่อง").map((r) => ({
      id: safeId(r["รหัสเรื่อง"]),
      data: { code: clean(r["รหัสเรื่อง"]), unitCode: clean(r["รหัสหน่วย"]), name: clean(r["ชื่อเรื่อง"]),
              source: clean(r["ที่มา"]) },
    })),
    eb_questions: rows(wb, "ข้อสอบ").filter((r) => clean(r["รหัสข้อ"])).map((r) => {
      const type = TYPE[clean(r["ประเภท"])] || clean(r["ประเภท"]);
      const isMC = type === "mc4" || type === "mc5";
      return {
        id: safeId(r["รหัสข้อ"]),
        data: {
          code: clean(r["รหัสข้อ"]), subject: clean(r["วิชา"]), level: clean(r["ชั้น"]), type,
          text: clean(r["โจทย์"]),
          choices: isMC ? ["ตัวเลือก ก", "ตัวเลือก ข", "ตัวเลือก ค", "ตัวเลือก ง", "ตัวเลือก จ"]
                           .slice(0, type === "mc5" ? 5 : 4).map((k) => clean(r[k])) : [],
          answer: clean(r["เฉลย"]), solution: clean(r["เฉลยละเอียด"]),
          points: Number(r["คะแนนเต็ม"]) || 1, difficulty: clean(r["ความยาก"]),
          topicCode: clean(r["เรื่อง (รหัส)"]), indicatorMain: clean(r["ตัวชี้วัดหลัก"]),
          indicatorSecondary: list(r["ตัวชี้วัดรอง"]), tags: list(r["แท็ก"]),
          source: clean(r["แหล่งที่มา"]), imageFiles: clean(r["ไฟล์รูป"]), images: [],
          note: clean(r["หมายเหตุให้ครูตรวจ"]),
          status: clean(r["สถานะ"]).startsWith("ตรวจแล้ว") ? "verified" : "draft",
          trashed: false,
        },
      };
    }),
  };
}

export default function ImportExamBank() {
  const [data, setData] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setLog([]);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      setData(build(wb));
    } catch (err) {
      setData(null);
      setLog(["อ่านไฟล์ไม่ได้: " + err.message]);
    }
  }

  async function doImport() {
    setBusy(true);
    setLog([]);
    try {
      for (const [coll, items] of Object.entries(data)) {
        for (let i = 0; i < items.length; i += 400) {
          const batch = writeBatch(db);
          items.slice(i, i + 400).forEach((it) =>
            batch.set(doc(db, coll, it.id), { ...it.data, updatedAt: serverTimestamp() }, { merge: true })
          );
          await batch.commit();
        }
        setLog((l) => [...l, `✓ ${coll}: ${items.length} รายการ`]);
      }
      setLog((l) => [...l, "นำเข้าเสร็จแล้ว"]);
    } catch (err) {
      setLog((l) => [...l, "ผิดพลาด: " + err.message]);
    }
    setBusy(false);
  }

  return (
    <div style={{ maxWidth: 640, margin: "24px auto", padding: 16, fontFamily: "inherit" }}>
      <h2 style={{ marginTop: 0 }}>นำเข้าคลังข้อสอบจาก Excel</h2>
      <p>เลือกไฟล์ ExamBank_v1_pilot.xlsx ระบบจะแสดงจำนวนรายการก่อน แล้วค่อยกดนำเข้า</p>
      <input type="file" accept=".xlsx" onChange={onFile} />
      {data && (
        <div style={{ margin: "16px 0" }}>
          {Object.entries(data).map(([k, v]) => (
            <div key={k}>{k}: {v.length} รายการ</div>
          ))}
          <p style={{ color: "#a15c00" }}>
            นำเข้าซ้ำได้ แต่ข้อมูลที่ตรงกับ Excel จะถูกเขียนทับ (รวมที่แก้ในแอปไปแล้ว)
          </p>
          <button onClick={doImport} disabled={busy}>
            {busy ? "กำลังนำเข้า..." : "นำเข้าลง Firestore"}
          </button>
        </div>
      )}
      {log.map((t, i) => <div key={i}>{t}</div>)}
    </div>
  );
}
