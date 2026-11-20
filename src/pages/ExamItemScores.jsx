import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { collection, doc, getDoc, getDocs, writeBatch, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnPrimary, btnSecondary } from "../theme";

const round2 = (n) => Math.round(n * 100) / 100;

export default function ExamItemScores() {
  const { classroomId, subjectId, assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [items, setItems] = useState([]);
  const [students, setStudents] = useState([]);
  const [existing, setExisting] = useState(0);
  const [parsed, setParsed] = useState(null);
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const base = ["classrooms", classroomId, "subjects", subjectId, "assignments", assignmentId];
  const nameOf = (s) => `${s.prefix || ""}${s.firstName} ${s.lastName}`;
  const codeOf = (s) => String(s.studentCode ?? s.id).trim();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [aSnap, cSnap, stSnap] = await Promise.all([
          getDoc(doc(db, ...base)),
          getDoc(doc(db, ...base, "itemAnalysis", "config")),
          getDocs(collection(db, "classrooms", classroomId, "students")),
        ]);
        if (cancelled) return;
        if (aSnap.exists()) setAssignment(aSnap.data());
        if (cSnap.exists()) setItems(cSnap.data().items || []);
        setStudents(stSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.no - b.no));
        try {
          const rSnap = await getDocs(collection(db, ...base, "itemScores"));
          if (!cancelled) setExisting(rSnap.size);
        } catch {
          /* ยังไม่มีสิทธิ์อ่าน หรือยังไม่มีข้อมูล */
        }
      } catch {
        if (!cancelled) setError("โหลดข้อมูลไม่สำเร็จ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, subjectId, assignmentId]);

  const downloadTemplate = () => {
    const rows = students.map((s) => {
      const row = { เลขที่: s.no, รหัสประจำตัว: codeOf(s), "ชื่อ-นามสกุล": nameOf(s) };
      items.forEach((it) => {
        row[`ข้อ ${it.no} (เต็ม ${it.maxScore})`] = "";
      });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "คะแนนรายข้อ");
    XLSX.writeFile(wb, `คะแนนรายข้อ_${assignment?.title || "ข้อสอบ"}.xlsx`);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setMsg("");
    setParsed(null);
    setProblems([]);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      if (rows.length === 0) {
        setError("ไม่พบข้อมูลในไฟล์");
        return;
      }
      const colByNo = {};
      Object.keys(rows[0]).forEach((h) => {
        const m = String(h).match(/^ข้อ\s*(\d+)/);
        if (m) colByNo[Number(m[1])] = h;
      });
      const missing = items.filter((it) => !colByNo[it.no]).map((it) => it.no);
      if (missing.length) {
        setError(`ไม่พบคอลัมน์ข้อ ${missing.join(", ")} ในไฟล์ (หัวคอลัมน์ต้องขึ้นต้นด้วย "ข้อ" ตามด้วยเลขข้อ)`);
        return;
      }
      const byCode = {};
      students.forEach((s) => {
        byCode[codeOf(s)] = s;
      });

      const out = [];
      const probs = [];
      rows.forEach((r, idx) => {
        const code = String(r["รหัสประจำตัว"] ?? "").trim();
        if (!code) return;
        const st = byCode[code];
        if (!st) {
          probs.push(`แถว ${idx + 2}: ไม่พบรหัส ${code} ในห้องนี้`);
          return;
        }
        const scores = {};
        let total = 0;
        let filled = 0;
        let bad = false;
        items.forEach((it) => {
          const raw = r[colByNo[it.no]];
          if (raw === "" || raw === null || raw === undefined) {
            scores[it.no] = null;
            return;
          }
          const v = Number(raw);
          if (Number.isNaN(v) || v < 0 || v > it.maxScore) {
            probs.push(`แถว ${idx + 2} (${st.firstName}): ข้อ ${it.no} ค่า "${raw}" ไม่ถูกต้อง (ต้องเป็น 0-${it.maxScore})`);
            bad = true;
            return;
          }
          scores[it.no] = v;
          total += v;
          filled += 1;
        });
        if (!bad) out.push({ id: st.id, no: st.no, name: nameOf(st), scores, total: round2(total), filled });
      });
      setParsed(out);
      setProblems(probs);
    } catch {
      setError("อ่านไฟล์ไม่สำเร็จ ตรวจสอบว่าเป็นไฟล์ .xlsx");
    }
  };

  const save = async () => {
    if (!parsed || parsed.length === 0 || problems.length > 0) return;
    if (existing > 0 && !window.confirm("มีคะแนนรายข้อเดิมอยู่แล้ว การบันทึกจะแทนที่คะแนนของนักเรียนที่อยู่ในไฟล์นี้ ต้องการทำต่อหรือไม่?")) return;
    setSaving(true);
    setError("");
    try {
      const batch = writeBatch(db);
      parsed.forEach((p) => {
        batch.set(doc(db, ...base, "itemScores", p.id), {
          studentId: p.id,
          scores: p.scores,
          total: p.total,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setMsg(`บันทึกคะแนนรายข้อของนักเรียน ${parsed.length} คนเรียบร้อย`);
      setExisting((n) => Math.max(n, parsed.length));
      setParsed(null);
    } catch {
      setError("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const emptyRows = parsed ? parsed.filter((p) => p.filled === 0).length : 0;

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าวิชา
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>
        คะแนนรายข้อ{assignment ? `: ${assignment.title}` : ""}
      </h2>

      {loading && <p style={{ color: theme.muted }}>กำลังโหลด...</p>}

      {!loading && items.length === 0 && (
        <p style={{ color: theme.danger }}>
          ยังไม่มีโครงข้อ{" "}
          <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}/assignment/${assignmentId}/items`}>
            ไปสร้างโครงข้อก่อน
          </Link>
        </p>
      )}

      {items.length > 0 && (
        <>
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>1. ดาวน์โหลดแม่แบบ</h3>
            <p style={{ margin: "0 0 10px", color: theme.muted, fontSize: 13 }}>
              {students.length} คน · {items.length} ข้อ · ช่องว่างหมายถึงไม่มีคะแนน (เช่น ขาดสอบ) ห้ามแก้รหัสประจำตัวและหัวคอลัมน์
            </p>
            <button type="button" style={btnSecondary} onClick={downloadTemplate} disabled={students.length === 0}>
              ดาวน์โหลดแม่แบบ (Excel)
            </button>
          </div>

          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>2. อัปโหลดไฟล์ที่กรอกแล้ว</h3>
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} />
            {existing > 0 && (
              <p style={{ margin: "8px 0 0", color: theme.muted, fontSize: 13 }}>
                ตอนนี้มีคะแนนรายข้อบันทึกไว้แล้ว {existing} คน
              </p>
            )}
          </div>
        </>
      )}

      {problems.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16, borderColor: "#FCA5A5", background: theme.dangerBg }}>
          <b style={{ color: theme.danger }}>พบข้อผิดพลาด {problems.length} จุด แก้ในไฟล์แล้วอัปโหลดใหม่</b>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 13 }}>
            {problems.slice(0, 10).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          {problems.length > 10 && <p style={{ fontSize: 13 }}>...และอีก {problems.length - 10} จุด</p>}
        </div>
      )}

      {parsed && parsed.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>3. ตรวจสอบก่อนบันทึก</h3>
          <p style={{ margin: "0 0 10px", fontSize: 14 }}>
            พร้อมบันทึก {parsed.length} คน
            {emptyRows > 0 && <span style={{ color: theme.muted }}> (ไม่มีคะแนนเลย {emptyRows} คน ระบบจะถือว่าไม่ได้เข้าสอบ)</span>}
          </p>
          <div style={{ overflowX: "auto", maxHeight: 260, overflowY: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 320 }}>
              <thead>
                <tr style={{ color: theme.muted, textAlign: "left" }}>
                  <th style={{ padding: "4px 10px" }}>เลขที่</th>
                  <th style={{ padding: "4px 10px" }}>ชื่อ</th>
                  <th style={{ padding: "4px 10px" }}>รวม</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((p) => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${theme.border}` }}>
                    <td style={{ padding: "4px 10px" }}>{p.no}</td>
                    <td style={{ padding: "4px 10px" }}>{p.name}</td>
                    <td style={{ padding: "4px 10px" }}>{p.filled === 0 ? "-" : p.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" style={btnPrimary} onClick={save} disabled={saving || problems.length > 0}>
              {saving ? "กำลังบันทึก..." : "บันทึกคะแนนรายข้อ"}
            </button>
          </div>
        </div>
      )}
      {saved.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>คะแนนรายข้อที่บันทึกไว้แล้ว</h3>
          <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 320 }}>
              <thead>
                <tr style={{ color: theme.muted, textAlign: "left" }}>
                  <th style={th}>เลขที่</th>
                  <th style={th}>ชื่อ</th>
                  <th style={th}>คะแนนรวมจากรายข้อ</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const p = saved.find((x) => x.id === s.id);
                  return (
                    <tr key={s.id} style={{ borderTop: `1px solid ${theme.border}` }}>
                      <td style={td}>{s.no}</td>
                      <td style={td}>{nameOf(s)}</td>
                      <td style={td}>
                        {p ? (p.filled === 0 ? "ไม่ได้เข้าสอบ" : `${p.total} / ${totalMax}`) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {msg && <p style={{ color: theme.success }}>{msg}</p>}
    </div>
  );
}