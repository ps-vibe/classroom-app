import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { ASSIGNMENT_TYPES, typeLabel } from "../constants";
import { theme, cardStyle, btnSecondary, btnTeal, inputStyle } from "../theme";

const emptyRow = { score: "", retake: "" };

// ป้ายสถานะการส่งงานจากข้อมูลที่นำเข้าจาก Google Classroom
function submInfo(v) {
  if (!v) return null;
  if (v.state === "not_submitted") return { key: "not", text: "ยังไม่ส่ง", bg: "#FEE2E2", color: "#B91C1C" };
  if (v.state === "returned") return { key: "ret", text: "คืนงานแล้ว", bg: "#E5E7EB", color: "#374151" };
  if (v.daysLate > 0) return { key: "late", text: `ส่งช้า ${v.daysLate} วัน`, bg: "#FEF3C7", color: "#92400E" };
  if (v.lateFlag) return { key: "late", text: "ส่งช้า (ไม่ทราบจำนวนวัน)", bg: "#FEF3C7", color: "#92400E" };
  return { key: "ok", text: "ส่งตรงเวลา", bg: "#DCFCE7", color: "#166534" };
}

export default function ScoreEntry() {
  const { classroomId, subjectId, assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [students, setStudents] = useState([]);
  const [rows, setRows] = useState({});
  const [itemTotals, setItemTotals] = useState({});
  const [subm, setSubm] = useState({});
  const [dirty, setDirty] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [aSnap, sSnap, scSnap] = await Promise.all([
          getDoc(doc(db, "classrooms", classroomId, "subjects", subjectId, "assignments", assignmentId)),
          getDocs(query(collection(db, "classrooms", classroomId, "students"), orderBy("no"))),
          getDocs(query(collection(db, "classrooms", classroomId, "scores"), where("assignmentId", "==", assignmentId))),
        ]);
        if (aSnap.exists()) setAssignment(aSnap.data());
        const list = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setStudents(list);
        const initial = {};
        list.forEach((s) => (initial[s.id] = { ...emptyRow }));
        scSnap.docs.forEach((d) => {
          const v = d.data();
          initial[v.studentCode] = {
            score: v.score ?? "",
            retake: v.retakeScore ?? "",
          };
        });
        setRows(initial);

        // คะแนนรวมจากรายข้อ (ถ้ามี) ใช้แสดงเทียบและเติมลงช่องคะแนน
        try {
          const itSnap = await getDocs(
            collection(db, "classrooms", classroomId, "subjects", subjectId, "assignments", assignmentId, "itemScores")
          );
          const totals = {};
          itSnap.docs.forEach((d) => {
            const v = d.data();
            const vals = Object.values(v.scores || {});
            if (vals.some((x) => x !== null && x !== undefined)) totals[d.id] = v.total;
          });
          setItemTotals(totals);
        } catch {
          /* ยังไม่มีคะแนนรายข้อ หรือยังไม่มีสิทธิ์อ่าน */
        }

        // สถานะการส่งงานที่นำเข้าจาก Google Classroom (ถ้ามี)
        try {
          const sbSnap = await getDocs(
            query(collection(db, "classrooms", classroomId, "submissions"), where("assignmentId", "==", assignmentId))
          );
          const sb = {};
          sbSnap.docs.forEach((d) => {
            sb[d.data().studentCode] = d.data();
          });
          setSubm(sb);
        } catch {
          /* ยังไม่ได้นำเข้า หรือยังไม่มีสิทธิ์อ่าน */
        }
      } catch {
        setError("โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [classroomId, subjectId, assignmentId]);

  if (loading) return <p>กำลังโหลด...</p>;
  if (!assignment) return <p>ไม่พบใบงานนี้</p>;

  const max = assignment.maxScore;
  const isExam = !!ASSIGNMENT_TYPES.find((t) => t.value === assignment.type)?.isExam;
  const hasItemTotals = isExam && Object.keys(itemTotals).length > 0;
  const hasSubm = Object.keys(subm).length > 0;
  const belowHalf = (score) => isExam && score !== "" && Number(score) < max / 2;

  const submCount = { ok: 0, late: 0, not: 0, ret: 0 };
  students.forEach((s) => {
    const info = submInfo(subm[s.id]);
    if (info) submCount[info.key] += 1;
  });

  const updateRow = (code, patch) => {
    setRows((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
    setDirty((prev) => new Set(prev).add(code));
    setMessage("");
  };

  const onScore = (code, value) => {
    const patch = { score: value };
    if (!belowHalf(value)) patch.retake = "";
    updateRow(code, patch);
  };

  const fillFromItems = () => {
    const codes = Object.keys(itemTotals).filter((c) => rows[c]);
    if (codes.length === 0) return;
    if (
      !window.confirm(
        `ใส่คะแนนจากรายข้อให้นักเรียน ${codes.length} คน (จะทับตัวเลขในช่องคะแนนของคนเหล่านี้) แล้วต้องกด "บันทึกคะแนน" เพื่อยืนยัน ต้องการทำต่อหรือไม่?`
      )
    )
      return;
    setRows((prev) => {
      const next = { ...prev };
      codes.forEach((code) => {
        const v = String(itemTotals[code]);
        next[code] = { ...next[code], score: v, retake: belowHalf(v) ? next[code].retake : "" };
      });
      return next;
    });
    setDirty((prev) => {
      const s = new Set(prev);
      codes.forEach((c) => s.add(c));
      return s;
    });
    setMessage("");
  };

  const inRange = (value) => {
    const n = Number(value);
    return !isNaN(n) && n >= 0 && n <= max;
  };

  const save = async () => {
    setError("");
    setMessage("");
    const codes = [...dirty];
    for (const code of codes) {
      const r = rows[code];
      if (r.score !== "" && !inRange(r.score)) {
        setError(`รหัส ${code}: คะแนนต้องอยู่ระหว่าง 0 ถึง ${max}`);
        return;
      }
      if (r.retake !== "" && !inRange(r.retake)) {
        setError(`รหัส ${code}: คะแนนซ่อมต้องอยู่ระหว่าง 0 ถึง ${max}`);
        return;
      }
    }
    setBusy(true);
    try {
      for (let i = 0; i < codes.length; i += 400) {
        const batch = writeBatch(db);
        codes.slice(i, i + 400).forEach((code) => {
          const r = rows[code];
          const ref = doc(db, "classrooms", classroomId, "scores", `${assignmentId}_${code}`);
          const empty = r.score === "" && r.retake === "";
          if (empty) {
            batch.delete(ref);
          } else {
            batch.set(
              ref,
              {
                assignmentId,
                subjectId,
                studentCode: code,
                score: r.score === "" ? null : Number(r.score),
                retakeScore: r.retake === "" ? null : Number(r.retake),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          }
        });
        await batch.commit();
      }
      setDirty(new Set());
      setMessage(`บันทึกแล้ว ${codes.length} รายการ`);
    } catch {
      setError("บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const cell = { border: `1px solid ${theme.border}`, padding: 10, textAlign: "left" };

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าวิชา
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>
        {assignment.title} <span style={{ color: theme.muted, fontWeight: 400, fontSize: 16 }}>[{typeLabel(assignment.type)}]</span>
      </h2>
      <p style={{ color: theme.muted, marginBottom: 8 }}>คะแนนเต็ม {max} | กำหนดส่ง {assignment.dueDate}</p>
      {hasSubm && (
        <p style={{ fontSize: 13, color: theme.muted, marginBottom: 12 }}>
          สถานะส่งงานจาก Google Classroom: ส่งตรงเวลา {submCount.ok} · ส่งช้า {submCount.late} · ยังไม่ส่ง {submCount.not} · คืนงานแล้ว {submCount.ret}
        </p>
      )}

      {students.length === 0 ? (
        <p style={{ color: theme.muted }}>ห้องนี้ยังไม่มีนักเรียน</p>
      ) : (
        <>
          <div style={{ position: "sticky", top: 0, background: theme.bg, padding: "8px 0", zIndex: 1 }}>
            <button style={btnTeal} onClick={save} disabled={busy || dirty.size === 0}>
              {busy ? "กำลังบันทึก..." : `บันทึกคะแนน${dirty.size ? ` (${dirty.size} รายการที่แก้)` : ""}`}
            </button>
            {hasItemTotals && (
              <button style={{ ...btnSecondary, marginLeft: 8 }} onClick={fillFromItems} disabled={busy}>
                ใส่คะแนนจากรายข้อ
              </button>
            )}
            {error && <span style={{ color: theme.danger, marginLeft: 12 }}>{error}</span>}
            {message && <span style={{ color: theme.success, marginLeft: 12 }}>{message}</span>}
          </div>

          <div style={{ ...cardStyle, overflowX: "auto", padding: 0, marginTop: 12 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  <th style={cell}>เลขที่</th>
                  <th style={cell}>ชื่อ-นามสกุล</th>
                  <th style={cell}>คะแนน</th>
                  {hasItemTotals && <th style={cell}>รวมจากรายข้อ</th>}
                  {hasSubm && <th style={cell}>สถานะส่งงาน (Classroom)</th>}
                  {isExam && <th style={cell}>ซ่อม</th>}
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const r = rows[s.id] || emptyRow;
                  const low = belowHalf(r.score);
                  const itemTotal = itemTotals[s.id];
                  const hasItem = itemTotal !== undefined;
                  const same = hasItem && r.score !== "" && Number(r.score) === Number(itemTotal);
                  const info = submInfo(subm[s.id]);
                  return (
                    <tr key={s.id} style={low ? { background: "#FEF2F2" } : undefined}>
                      <td style={cell}>{s.no}</td>
                      <td style={cell}>{s.prefix}{s.firstName} {s.lastName}</td>
                      <td style={cell}>
                        <input
                          type="number"
                          min="0"
                          max={max}
                          step="any"
                          value={r.score}
                          onChange={(e) => onScore(s.id, e.target.value)}
                          style={{ ...inputStyle, width: 70, padding: 6 }}
                        />{" "}
                        / {max}
                      </td>
                      {hasItemTotals && (
                        <td style={cell}>
                          {hasItem ? (
                            <span style={{ fontWeight: 700, color: same ? theme.success : theme.danger }}>{itemTotal}</span>
                          ) : (
                            "-"
                          )}
                        </td>
                      )}
                      {hasSubm && (
                        <td style={cell}>
                          {info ? (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 10px",
                                borderRadius: 999,
                                fontSize: 12,
                                fontWeight: 700,
                                background: info.bg,
                                color: info.color,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {info.text}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                      )}
                      {isExam && (
                        <td style={cell}>
                          {low ? (
                            <input
                              type="number"
                              min="0"
                              max={max}
                              step="any"
                              placeholder="คะแนนซ่อม"
                              value={r.retake}
                              onChange={(e) => updateRow(s.id, { retake: e.target.value })}
                              style={{ ...inputStyle, width: 90, padding: 6 }}
                            />
                          ) : (
                            "-"
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}