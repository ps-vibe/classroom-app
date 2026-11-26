import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnPrimary, btnSecondary, inputStyle } from "../theme";

const SUBS = ["itemAnalysis", "itemScores", "rubric"];
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const todayStr = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const safeFile = (s) => String(s || "ห้อง").replace(/[\\/:*?"<>|]/g, "_");

// แปลง Timestamp ของ Firestore เป็นข้อความ เพื่อเก็บลงไฟล์ JSON ได้
function serialize(v) {
  if (v === null || v === undefined) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(serialize);
  if (typeof v === "object") {
    const o = {};
    Object.keys(v).forEach((k) => {
      o[k] = serialize(v[k]);
    });
    return o;
  }
  return v;
}
const toObj = (d) => ({ id: d.id, ...serialize(d.data()) });

async function fetchLibrary() {
  const snap = await getDocs(collection(db, "rubricCriteria"));
  return snap.docs.map(toObj);
}

async function fetchClassroom(classroomId) {
  const col = (...p) => collection(db, "classrooms", classroomId, ...p);
  const [roomSnap, stSnap, subjSnap, scSnap, atSnap, logSnap, exSnap, ppSnap, raSnap, sbSnap] = await Promise.all([
    getDoc(doc(db, "classrooms", classroomId)),
    getDocs(col("students")),
    getDocs(col("subjects")),
    getDocs(col("scores")),
    getDocs(col("attendance")),
    getDocs(col("attendanceLog")),
    getDocs(col("retakeExams")),
    getDocs(col("retakePapers")),
    getDocs(col("retakeAttempts")),
    getDocs(col("submissions")),
  ]);

  const subjects = [];
  for (const s of subjSnap.docs) {
    const aSnap = await getDocs(col("subjects", s.id, "assignments"));
    const assignments = await Promise.all(
      aSnap.docs.map(async (a) => {
        const parts = await Promise.all(
          SUBS.map((n) => getDocs(col("subjects", s.id, "assignments", a.id, n)))
        );
        const subcollections = {};
        SUBS.forEach((n, i) => {
          subcollections[n] = parts[i].docs.map(toObj);
        });
        return { ...toObj(a), subcollections };
      })
    );
    subjects.push({ ...toObj(s), assignments });
  }

  return {
    format: "classroom-backup-v1",
    exportedAt: new Date().toISOString(),
    classroomId,
    classroom: roomSnap.exists() ? serialize(roomSnap.data()) : null,
    students: stSnap.docs.map(toObj),
    subjects,
    scores: scSnap.docs.map(toObj),
    attendance: atSnap.docs.map(toObj),
    attendanceLog: logSnap.docs.map(toObj),
    retakeExams: exSnap.docs.map(toObj),
    retakePapers: ppSnap.docs.map(toObj),
    retakeAttempts: raSnap.docs.map(toObj),
    submissions: sbSnap.docs.map(toObj),
  };
}

function describe(data) {
  const asg = data.subjects.reduce((s, x) => s + x.assignments.length, 0);
  return `นักเรียน ${data.students.length} คน · วิชา ${data.subjects.length} · ใบงาน ${asg} · คะแนน ${data.scores.length} รายการ · เช็คคาบเรียน ${data.attendance.length} รายการ`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const downloadJson = (obj, fileName) =>
  downloadBlob(new Blob([JSON.stringify(obj)], { type: "application/json" }), fileName);

function buildWorkbook(data) {
  const wb = XLSX.utils.book_new();
  const students = [...data.students].sort((a, b) => (a.no || 0) - (b.no || 0));
  const nameOf = (s) => `${s.prefix || ""}${s.firstName || ""} ${s.lastName || ""}`.trim();
  const usedNames = new Set();
  const addSheet = (rows, baseName) => {
    let name = String(baseName || "ชีต").replace(/[\\/?*[\]:]/g, "").slice(0, 28) || "ชีต";
    let n = 2;
    let candidate = name;
    while (usedNames.has(candidate)) {
      candidate = `${name.slice(0, 26)}_${n}`;
      n += 1;
    }
    usedNames.add(candidate);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ ข้อความ: "ไม่มีข้อมูล" }]), candidate);
  };

  addSheet(
    students.map((s) => ({ เลขที่: s.no, รหัสประจำตัว: s.id, "ชื่อ-นามสกุล": nameOf(s) })),
    "รายชื่อนักเรียน"
  );

  const scoreMap = {};
  data.scores.forEach((sc) => {
    scoreMap[`${sc.assignmentId}_${sc.studentCode}`] = sc;
  });

  data.subjects.forEach((subj) => {
    const asg = [...subj.assignments].sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));
    const hasRetake = {};
    data.scores.forEach((sc) => {
      if (sc.retakeScore !== null && sc.retakeScore !== undefined) hasRetake[sc.assignmentId] = true;
    });
    const headers = {};
    const used = new Set();
    asg.forEach((a) => {
      let h = `${a.title} (เต็ม ${a.maxScore})`;
      if (used.has(h)) h = `${a.title} ${a.dueDate || ""} (เต็ม ${a.maxScore})`;
      let k = 2;
      const orig = h;
      while (used.has(h)) {
        h = `${orig} #${k}`;
        k += 1;
      }
      used.add(h);
      headers[a.id] = h;
    });
    const totalMax = round2(asg.reduce((s, a) => s + (Number(a.maxScore) || 0), 0));
    const rows = students.map((st) => {
      const row = { เลขที่: st.no, รหัสประจำตัว: st.id, "ชื่อ-นามสกุล": nameOf(st) };
      let sum = 0;
      asg.forEach((a) => {
        const sc = scoreMap[`${a.id}_${st.id}`];
        const v = sc?.score ?? "";
        row[headers[a.id]] = v;
        if (v !== "") sum += Number(v);
        if (hasRetake[a.id]) row[`${headers[a.id]} - ซ่อม`] = sc?.retakeScore ?? "";
      });
      row["รวม (ไม่รวมคะแนนซ่อม)"] = round2(sum);
      row["เต็มรวม"] = totalMax;
      return row;
    });
    addSheet(rows, `คะแนน_${subj.name || subj.id}`);
  });

  const attRows = [];
  data.subjects.forEach((subj) => {
    const total = data.attendanceLog.filter((l) => l.subjectId === subj.id).length;
    if (total === 0) return;
    students.forEach((st) => {
      const recs = data.attendance.filter((r) => r.subjectId === subj.id && r.studentCode === st.id);
      const late = recs.filter((r) => r.status === "late").length;
      const leave = recs.filter((r) => r.status === "leave").length;
      const absent = recs.filter((r) => r.status === "absent").length;
      const eff = Math.max(total - leave, 0);
      const present = Math.max(eff - absent, 0);
      attRows.push({
        วิชา: subj.name || subj.id,
        เลขที่: st.no,
        "ชื่อ-นามสกุล": nameOf(st),
        สาย: late,
        ลา: leave,
        ขาด: absent,
        คาบทั้งหมด: total,
        "เปอร์เซ็นต์การเข้าเรียน": eff > 0 ? round1((present / eff) * 100) : 100,
      });
    });
  });
  addSheet(attRows, "สรุปการเข้าเรียน");
  return wb;
}

export default function BackupExport() {
  const [classrooms, setClassrooms] = useState([]);
  const [classroomId, setClassroomId] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [last, setLast] = useState("");

  useEffect(() => {
    getDocs(collection(db, "classrooms"))
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, name: d.data().name || d.id }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setClassrooms(list);
        setClassroomId(list[0]?.id || "");
      })
      .catch(() => setError("โหลดรายชื่อห้องไม่สำเร็จ"))
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => {
    try {
      setLast(classroomId ? localStorage.getItem(`backupLast:${classroomId}`) || "" : "");
    } catch {
      setLast("");
    }
  }, [classroomId]);

  const markDone = (id) => {
    const now = new Date().toISOString();
    try {
      localStorage.setItem(`backupLast:${id}`, now);
    } catch {
      /* บันทึกวันที่ไม่ได้ ข้ามไป */
    }
    if (id === classroomId) setLast(now);
  };

  const room = classrooms.find((c) => c.id === classroomId);

  const backupOne = async () => {
    if (!room) return;
    setBusy(true);
    setError("");
    setSummary("");
    try {
      setStatus("กำลังอ่านข้อมูลห้อง...");
      const data = await fetchClassroom(classroomId);
      data.library = await fetchLibrary();
      downloadJson(data, `สำรอง_${safeFile(room.name)}_${todayStr()}.json`);
      markDone(classroomId);
      setSummary(`สำรองห้อง ${room.name} แล้ว: ${describe(data)}`);
    } catch (e) {
      setError("สำรองข้อมูลไม่สำเร็จ: " + e.message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const backupAll = async () => {
    if (classrooms.length === 0) return;
    setBusy(true);
    setError("");
    setSummary("");
    try {
      const out = [];
      for (let i = 0; i < classrooms.length; i++) {
        setStatus(`กำลังอ่านห้อง ${classrooms[i].name} (${i + 1}/${classrooms.length})...`);
        out.push(await fetchClassroom(classrooms[i].id));
      }
      setStatus("กำลังสร้างไฟล์...");
      const all = {
        format: "classroom-backup-all-v1",
        exportedAt: new Date().toISOString(),
        library: await fetchLibrary(),
        classrooms: out,
      };
      downloadJson(all, `สำรองทุกห้อง_${todayStr()}.json`);
      classrooms.forEach((c) => markDone(c.id));
      setSummary(`สำรองทุกห้องแล้ว ${out.length} ห้อง`);
    } catch (e) {
      setError("สำรองข้อมูลไม่สำเร็จ: " + e.message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const exportExcel = async () => {
    if (!room) return;
    setBusy(true);
    setError("");
    setSummary("");
    try {
      setStatus("กำลังอ่านข้อมูลห้อง...");
      const data = await fetchClassroom(classroomId);
      XLSX.writeFile(buildWorkbook(data), `คะแนนและการเข้าเรียน_${safeFile(room.name)}_${todayStr()}.xlsx`);
      setSummary(`ส่งออก Excel ห้อง ${room.name} แล้ว: ${describe(data)}`);
    } catch (e) {
      setError("ส่งออกไม่สำเร็จ: " + e.message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  return (
    <div>
      <Link to="/teacher" style={{ color: theme.accent, fontSize: 14 }}>&larr; กลับหน้าหลัก</Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>สำรองข้อมูล</h2>
      <p style={{ margin: "0 0 16px", color: theme.muted, fontSize: 13 }}>
        ดาวน์โหลดข้อมูลห้องเรียนเก็บไว้เป็นไฟล์ในเครื่องของคุณ แนะนำให้สำรองทุกเดือน และก่อนลบห้องหรือสิ้นภาคเรียน
      </p>

      {loadingList && <p style={{ color: theme.muted }}>กำลังโหลดรายชื่อห้อง...</p>}
      {!loadingList && classrooms.length === 0 && !error && <p style={{ color: theme.muted }}>ยังไม่มีห้องเรียน</p>}

      {classrooms.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <label style={{ fontSize: 14 }}>
            ห้องเรียน{" "}
            <select value={classroomId} onChange={(e) => setClassroomId(e.target.value)} style={{ ...inputStyle, marginLeft: 6 }} disabled={busy}>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <p style={{ margin: "8px 0 12px", fontSize: 13, color: theme.muted }}>
            {last ? `สำรองห้องนี้ล่าสุด: ${new Date(last).toLocaleString("th-TH")} (บันทึกไว้ในเบราว์เซอร์เครื่องนี้)` : "ยังไม่เคยสำรองห้องนี้จากเบราว์เซอร์เครื่องนี้"}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={btnPrimary} onClick={backupOne} disabled={busy}>
              ดาวน์โหลดไฟล์สำรองทั้งห้อง (JSON)
            </button>
            <button type="button" style={btnSecondary} onClick={exportExcel} disabled={busy}>
              ส่งออกคะแนนและการเข้าเรียน (Excel)
            </button>
          </div>
        </div>
      )}

      {classrooms.length > 1 && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>สำรองทุกห้อง</h3>
          <p style={{ margin: "0 0 10px", color: theme.muted, fontSize: 13 }}>รวมทุกห้อง ({classrooms.length} ห้อง) ไว้ในไฟล์เดียว</p>
          <button type="button" style={btnSecondary} onClick={backupAll} disabled={busy}>
            สำรองทุกห้องในไฟล์เดียว (JSON)
          </button>
        </div>
      )}

      {status && <p style={{ color: theme.muted, fontSize: 13 }}>{status}</p>}
      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {summary && <p style={{ color: theme.success }}>{summary}</p>}

      <details style={{ ...cardStyle, fontSize: 13 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>รายละเอียดและข้อควรระวัง</summary>
        <ul style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 4 }}>
          <li>ไฟล์สำรองมีชื่อและคะแนนนักเรียน เก็บไว้ในที่ปลอดภัยและอย่าส่งต่อ</li>
          <li>ไม่รวมรหัสผ่านห้อง รูปข้อสอบซ่อม และรายการสแกน QR ชั่วคราว</li>
          <li>ไฟล์ JSON ใช้เก็บเป็นหลักฐานหรือให้กู้คืนภายหลัง ส่วนไฟล์ Excel เปิดดูและพิมพ์ได้ทันที</li>
          <li>การสำรองนับเป็นการอ่านข้อมูลของ Firestore (แพ็กเกจฟรีอ่านได้ 50,000 ครั้ง/วัน) ห้องขนาดปกติใช้ไม่มาก แต่ไม่ควรกดซ้ำถี่ ๆ</li>
        </ul>
      </details>
    </div>
  );
}