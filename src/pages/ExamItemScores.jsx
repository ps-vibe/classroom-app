import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { ASSIGNMENT_TYPES } from "../constants";
import { theme, cardStyle, btnPrimary, btnSecondary, btnTeal } from "../theme";

const round2 = (n) => Math.round(n * 100) / 100;

export default function ExamItemScores() {
  const { classroomId, subjectId, assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [items, setItems] = useState([]);
  const [students, setStudents] = useState([]);
  const [saved, setSaved] = useState([]);
  const [parsed, setParsed] = useState(null);
  const [problems, setProblems] = useState([]);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
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
          if (!cancelled) {
            setSaved(
              rSnap.docs.map((d) => {
                const v = d.data();
                const vals = Object.values(v.scores || {});
                return {
                  id: d.id,
                  total: v.total,
                  filled: vals.filter((x) => x !== null && x !== undefined).length,
                };
              })
            );
          }
        } catch {
          /* ยังไม่มีข้อมูล หรือยังไม่มีสิทธิ์อ่าน */
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

  const totalMax = round2(items.reduce((s, it) => s + Number(it.maxScore || 0), 0));
  const maxMismatch = !!assignment && items.length > 0 && totalMax !== Number(assignment.maxScore);
  const isExam = !!ASSIGNMENT_TYPES.find((t) => t.value === assignment?.type)?.isExam;

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
    setPlan(null);
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
    if (saved.length > 0 && !window.confirm("มีคะแนนรายข้อเดิมอยู่แล้ว การบันทึกจะแทนที่คะแนนของนักเรียนที่อยู่ในไฟล์นี้ ต้องการทำต่อหรือไม่?")) return;
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
      setSaved((prev) => {
        const m = new Map(prev.map((x) => [x.id, x]));
        parsed.forEach((p) => m.set(p.id, { id: p.id, total: p.total, filled: p.filled }));
        return [...m.values()];
      });
      setParsed(null);
      setPlan(null);
    } catch {
      setError("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  // ---- ส่งคะแนนรวมไปหน้าคะแนนของใบงาน ----
  const buildPlan = async () => {
    setError("");
    setMsg("");
    try {
      const sc = await getDocs(
        query(collection(db, "classrooms", classroomId, "scores"), where("assignmentId", "==", assignmentId))
      );
      const old = {};
      sc.docs.forEach((d) => {
        old[d.data().studentCode] = d.data();
      });
      const stById = {};
      students.forEach((s) => {
        stById[s.id] = s;
      });
      const rows = [];
      let skipped = 0;
      saved.forEach((p) => {
        if (p.filled === 0) {
          skipped += 1;
          return;
        }
        const st = stById[p.id];
        if (!st) return;
        const o = old[p.id];
        rows.push({
          id: p.id,
          no: st.no,
          name: nameOf(st),
          exists: !!o,
          oldScore: o?.score ?? null,
          newScore: p.total,
          hadRetake: o?.retakeScore !== null && o?.retakeScore !== undefined,
        });
      });
      rows.sort((a, b) => a.no - b.no);
      setPlan({ rows, skipped });
    } catch {
      setError("โหลดคะแนนเดิมของใบงานไม่สำเร็จ");
    }
  };

  const confirmSync = async () => {
    if (!plan) return;
    const changed = plan.rows.filter((r) => r.oldScore !== r.newScore);
    if (changed.length === 0) {
      setPlan(null);
      setMsg("คะแนนในหน้าคะแนนตรงกันอยู่แล้ว ไม่มีรายการที่ต้องส่ง");
      return;
    }
    const max = Number(assignment.maxScore);
    setSyncing(true);
    setError("");
    try {
      for (let i = 0; i < changed.length; i += 400) {
        const batch = writeBatch(db);
        changed.slice(i, i + 400).forEach((r) => {
          const ref = doc(db, "classrooms", classroomId, "scores", `${assignmentId}_${r.id}`);
          if (r.exists) {
            const patch = { score: r.newScore, updatedAt: serverTimestamp() };
            if (isExam && !(r.newScore < max / 2) && r.hadRetake) patch.retakeScore = null;
            batch.set(ref, patch, { merge: true });
          } else {
            batch.set(ref, {
              assignmentId,
              subjectId,
              studentCode: r.id,
              score: r.newScore,
              late: false,
              accuracy: false,
              clean: false,
              retakeScore: null,
              updatedAt: serverTimestamp(),
            });
          }
        });
        await batch.commit();
      }
      setMsg(`ส่งคะแนนรวมไปหน้าคะแนนของใบงานแล้ว ${changed.length} คน`);
      setPlan(null);
    } catch {
      setError("ส่งคะแนนไม่สำเร็จ");
    } finally {
      setSyncing(false);
    }
  };

  const emptyRows = parsed ? parsed.filter((p) => p.filled === 0).length : 0;
  const changedRows = plan ? plan.rows.filter((r) => r.oldScore !== r.newScore) : [];
  const th = { padding: "4px 10px" };
  const td = { padding: "4px 10px" };

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
            {saved.length > 0 && (
              <p style={{ margin: "8px 0 0", color: theme.muted, fontSize: 13 }}>
                ตอนนี้มีคะแนนรายข้อบันทึกไว้แล้ว {saved.length} คน
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
                  <th style={th}>เลขที่</th>
                  <th style={th}>ชื่อ</th>
                  <th style={th}>รวม</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((p) => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${theme.border}` }}>
                    <td style={td}>{p.no}</td>
                    <td style={td}>{p.name}</td>
                    <td style={td}>{p.filled === 0 ? "-" : p.total}</td>
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

      {saved.length > 0 && assignment && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>4. ส่งคะแนนรวมไปหน้าคะแนนของใบงาน</h3>
          <p style={{ margin: "0 0 10px", color: theme.muted, fontSize: 13 }}>
            คะแนนรวมจากรายข้อจะแทนที่ช่อง "คะแนน" ในหน้ากรอกคะแนน (ที่นักเรียนเห็น) ส่วนเครื่องหมาย L / % / C ไม่ถูกแตะ
            และนักเรียนที่ไม่มีคะแนนรายข้อเลยจะไม่ถูกเปลี่ยน
          </p>
          {maxMismatch && (
            <p style={{ color: theme.danger, fontSize: 13, margin: "0 0 10px" }}>
              คะแนนเต็มรวมของโครงข้อ ({totalMax}) ไม่เท่ากับคะแนนเต็มของใบงาน ({assignment.maxScore}) แก้ที่หน้าโครงข้อหรือที่ใบงานก่อน จึงจะส่งคะแนนได้
            </p>
          )}
          {!plan && (
            <button type="button" style={btnSecondary} onClick={buildPlan} disabled={maxMismatch}>
              ดูตัวอย่างการส่งคะแนน
            </button>
          )}
          {plan && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: 14 }}>
                จะเปลี่ยน <b>{changedRows.length}</b> คน · ตรงกันอยู่แล้ว {plan.rows.length - changedRows.length} คน
                {plan.skipped > 0 && <span style={{ color: theme.muted }}> · ข้าม {plan.skipped} คน (ไม่มีคะแนนรายข้อ)</span>}
              </p>
              {changedRows.length > 0 && (
                <div style={{ overflowX: "auto", maxHeight: 260, overflowY: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 360 }}>
                    <thead>
                      <tr style={{ color: theme.muted, textAlign: "left" }}>
                        <th style={th}>เลขที่</th>
                        <th style={th}>ชื่อ</th>
                        <th style={th}>เดิม</th>
                        <th style={th}>ใหม่</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changedRows.map((r) => (
                        <tr key={r.id} style={{ borderTop: `1px solid ${theme.border}` }}>
                          <td style={td}>{r.no}</td>
                          <td style={td}>{r.name}</td>
                          <td style={td}>{r.oldScore === null ? "(ยังไม่มี)" : r.oldScore}</td>
                          <td style={td}><b>{r.newScore}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={btnTeal} onClick={confirmSync} disabled={syncing}>
                  {syncing ? "กำลังส่ง..." : changedRows.length === 0 ? "ปิด" : "ยืนยันส่งคะแนน"}
                </button>
                <button type="button" style={btnSecondary} onClick={() => setPlan(null)} disabled={syncing}>
                  ยกเลิก
                </button>
              </div>
            </>
          )}
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