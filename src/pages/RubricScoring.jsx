import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnPrimary, btnSecondary, btnTeal, inputStyle } from "../theme";
import { LEVEL_LABEL, DEFAULT_LATE_DAYS, lateText, levelFromLateDays, rubricPoints } from "../rubricUtils";

const round2 = (n) => Math.round(n * 100) / 100;
const newId = () => "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const SHOWN_LEVELS = [1, 2, 3, 4];
const EMPTY_ROW = { levels: {}, daysLate: "" };
const submText = (v) =>
  v.state === "not_submitted"
    ? "Classroom: ยังไม่ส่ง"
    : v.state === "returned"
    ? "Classroom: คืนงานแล้ว (ไม่ทราบวันที่ส่ง)"
    : v.daysLate > 0
    ? `Classroom: ส่งช้า ${v.daysLate} วัน`
    : v.lateFlag
    ? "Classroom: ส่งช้า (ไม่ทราบจำนวนวัน)"
    : "Classroom: ส่งตรงเวลา";

function LevelButtons({ value, onPick }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {SHOWN_LEVELS.map((l) => (
        <button
          key={l}
          type="button"
          title={LEVEL_LABEL[l]}
          onClick={() => onPick(l)}
          style={{
            width: 30,
            height: 30,
            fontWeight: 700,
            cursor: "pointer",
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            background: value === l ? theme.teal : "#fff",
            color: value === l ? "#fff" : theme.text,
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export default function RubricScoring() {
  const { classroomId, subjectId, assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [criteria, setCriteria] = useState([]);
  const [students, setStudents] = useState([]);
  const [ratings, setRatings] = useState({});
  const [dirty, setDirty] = useState(new Set());
  const [mode, setMode] = useState("individual");
  const [groups, setGroups] = useState([]);
  const [assign, setAssign] = useState({});
  const [groupsDirty, setGroupsDirty] = useState(false);
  const [showGroupEditor, setShowGroupEditor] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [problems, setProblems] = useState([]);
  const [subm, setSubm] = useState({});  
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const base = ["classrooms", classroomId, "subjects", subjectId, "assignments", assignmentId];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [aSnap, cfgSnap, grpSnap, stSnap, scSnap] = await Promise.all([
          getDoc(doc(db, ...base)),
          getDoc(doc(db, ...base, "rubric", "config")),
          getDoc(doc(db, ...base, "rubric", "groups")),
          getDocs(collection(db, "classrooms", classroomId, "students")),
          getDocs(query(collection(db, "classrooms", classroomId, "scores"), where("assignmentId", "==", assignmentId))),
        ]);
        if (cancelled) return;
        if (aSnap.exists()) setAssignment(aSnap.data());
        if (cfgSnap.exists()) setCriteria(cfgSnap.data().criteria || []);
        if (grpSnap.exists()) {
          const g = grpSnap.data();
          setMode(g.mode || "individual");
          setGroups(g.groups || []);
          setAssign(g.assign || {});
        }
        setStudents(stSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.no - b.no));
        const init = {};
        scSnap.docs.forEach((d) => {
          const v = d.data();
          if (v.rubricLevels || (v.daysLate !== undefined && v.daysLate !== null)) {
            init[v.studentCode] = {
              levels: { ...(v.rubricLevels || {}) },
              daysLate: v.daysLate === undefined || v.daysLate === null ? "" : String(v.daysLate),
            };
          }
        });
        setRatings(init);
        try {
          const sbSnap = await getDocs(
            query(collection(db, "classrooms", classroomId, "submissions"), where("assignmentId", "==", assignmentId))
          );
          const sb = {};
          sbSnap.docs.forEach((d) => {
            sb[d.data().studentCode] = d.data();
          });
          if (!cancelled) {
            setSubm(sb);
            setRatings((prev) => {
              const next = { ...prev };
              Object.entries(sb).forEach(([code, v]) => {
                const cur = next[code];
                if ((!cur || cur.daysLate === "") && typeof v.daysLate === "number") {
                  next[code] = { levels: cur?.levels || {}, daysLate: String(v.daysLate) };
                }
              });
              return next;
            });
          }
        } catch {
          /* ยังไม่ได้นำเข้าสถานะส่งงาน หรือยังไม่มีสิทธิ์อ่าน */
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

  if (loading) return <p>กำลังโหลด...</p>;
  if (!assignment) return <p>ไม่พบใบงานนี้</p>;

  const maxScore = Number(assignment.maxScore) || 0;
  const hasLate = criteria.some((c) => c.kind === "late");
  const nameOf = (s) => `${s.prefix || ""}${s.firstName} ${s.lastName}`;
  const studentById = {};
  students.forEach((s) => {
    studentById[s.id] = s;
  });
  const groupName = (studentId) => groups.find((g) => g.id === assign[studentId])?.name || "";

  const getRow = (id) => ratings[id] || EMPTY_ROW;

  const levelOf = (st, c) => {
    const r = getRow(st.id);
    if (c.kind === "late") {
      if (r.daysLate === "" || r.daysLate === undefined) return null;
      return levelFromLateDays(c.lateDays || DEFAULT_LATE_DAYS, Number(r.daysLate));
    }
    return r.levels?.[c.criterionId] ?? null;
  };

  const rowInfo = (st) => {
    let filled = 0;
    let sum = 0;
    criteria.forEach((c) => {
      const l = levelOf(st, c);
      if (l !== null) {
        filled += 1;
        sum += rubricPoints((maxScore * c.weight) / 100, l);
      }
    });
    return { filled, complete: criteria.length > 0 && filled === criteria.length, total: round2(sum) };
  };

  const patchRow = (id, fn) => {
    setRatings((prev) => ({ ...prev, [id]: fn(prev[id] || EMPTY_ROW) }));
    setDirty((prev) => new Set(prev).add(id));
    setMsg("");
  };
  const applyLevel = (id, cid, level) =>
    patchRow(id, (cur) => ({ ...cur, levels: { ...cur.levels, [cid]: level } }));
  const toggleLevel = (id, cid, level) =>
    patchRow(id, (cur) => ({ ...cur, levels: { ...cur.levels, [cid]: cur.levels[cid] === level ? null : level } }));
  const setDays = (id, v) => patchRow(id, (cur) => ({ ...cur, daysLate: v }));

  const fillZeroDays = () => {
    students.forEach((s) => {
      if (getRow(s.id).daysLate === "") setDays(s.id, "0");
    });
  };

  const groupDays = (members) => {
    const v = window.prompt("ส่งช้ากี่วัน (ใช้กับทุกคนในกลุ่ม, 0 = ตรงเวลา)", "0");
    if (v === null) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      setError("จำนวนวันต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
      return;
    }
    setError("");
    members.forEach((m) => setDays(m.id, String(n)));
  };

  // ---------- บันทึกคะแนน ----------
  const save = async () => {
    setError("");
    setMsg("");
    const partial = [];
    const toWrite = [];
    [...dirty].forEach((id) => {
      const st = studentById[id];
      if (!st) return;
      const info = rowInfo(st);
      if (info.filled === 0) return;
      if (!info.complete) {
        partial.push(`เลขที่ ${st.no} ${st.firstName}`);
        return;
      }
      toWrite.push({ st, info });
    });
    if (partial.length > 0) {
      setError(
        `ให้คะแนนยังไม่ครบทุกเกณฑ์: ${partial.slice(0, 5).join(", ")}${partial.length > 5 ? ` และอีก ${partial.length - 5} คน` : ""}`
      );
      return;
    }
    if (toWrite.length === 0) {
      setMsg("ไม่มีรายการที่ต้องบันทึก");
      return;
    }
    setBusy(true);
    try {
      for (let i = 0; i < toWrite.length; i += 400) {
        const batch = writeBatch(db);
        toWrite.slice(i, i + 400).forEach(({ st, info }) => {
          const levels = {};
          criteria.forEach((c) => {
            levels[c.criterionId] = levelOf(st, c);
          });
          const payload = {
            assignmentId,
            subjectId,
            studentCode: st.id,
            score: info.total,
            rubricLevels: levels,
            updatedAt: serverTimestamp(),
          };
          if (hasLate) payload.daysLate = Number(getRow(st.id).daysLate);
          batch.set(doc(db, "classrooms", classroomId, "scores", `${assignmentId}_${st.id}`), payload, { merge: true });
        });
        await batch.commit();
      }
      setDirty(new Set());
      setMsg(`บันทึกคะแนนแล้ว ${toWrite.length} คน (คะแนนรวมไปอยู่ในหน้ากรอกคะแนนด้วย)`);
    } catch {
      setError("บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  // ---------- รูปแบบงานและกลุ่ม ----------
  const addGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    setGroups((prev) => [...prev, { id: newId(), name }]);
    setNewGroupName("");
    setGroupsDirty(true);
  };
  const removeGroup = (id) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setAssign((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (next[k] === id) delete next[k];
      });
      return next;
    });
    setGroupsDirty(true);
  };
  const setStudentGroup = (studentId, groupId) => {
    setAssign((prev) => {
      const next = { ...prev };
      if (groupId) next[studentId] = groupId;
      else delete next[studentId];
      return next;
    });
    setGroupsDirty(true);
  };
  const saveGroups = async () => {
    setError("");
    try {
      await setDoc(doc(db, ...base, "rubric", "groups"), { mode, groups, assign, updatedAt: serverTimestamp() });
      setGroupsDirty(false);
      setMsg("บันทึกรูปแบบงานและกลุ่มเรียบร้อย");
    } catch {
      setError("บันทึกกลุ่มไม่สำเร็จ (ตรวจ Firestore rules ของ rubric)");
    }
  };

  // ---------- Excel ----------
  const colHeader = (c, i) => `${i + 1}. ${c.name}${c.kind === "late" ? " (วันที่ส่งช้า)" : " (ระดับ 1-4)"}`;

  const downloadTemplate = () => {
    const rows = students.map((s) => {
      const row = { เลขที่: s.no, รหัสประจำตัว: String(s.id), "ชื่อ-นามสกุล": nameOf(s) };
      if (mode === "group") row["กลุ่ม"] = groupName(s.id);
      const r = getRow(s.id);
      criteria.forEach((c, i) => {
        row[colHeader(c, i)] = c.kind === "late" ? r.daysLate : r.levels?.[c.criterionId] ?? "";
      });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ประเมินตามเกณฑ์");
    XLSX.writeFile(wb, `ประเมินตามเกณฑ์_${assignment.title}.xlsx`);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setMsg("");
    setProblems([]);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      if (rows.length === 0) {
        setError("ไม่พบข้อมูลในไฟล์");
        return;
      }
      const colByIdx = {};
      Object.keys(rows[0]).forEach((h) => {
        const m = String(h).match(/^(\d+)\./);
        if (m) colByIdx[Number(m[1]) - 1] = h;
      });
      const missing = criteria.map((c, i) => i).filter((i) => !colByIdx[i]);
      if (missing.length > 0) {
        setError(`ไม่พบคอลัมน์ของเกณฑ์ข้อ ${missing.map((i) => i + 1).join(", ")} (หัวคอลัมน์ต้องขึ้นต้นด้วยเลขข้อและจุด เช่น "1. ...")`);
        return;
      }
      const byCode = {};
      students.forEach((s) => {
        byCode[String(s.id).trim()] = s;
      });
      const updates = [];
      const probs = [];
      rows.forEach((r, idx) => {
        const code = String(r["รหัสประจำตัว"] ?? "").trim();
        if (!code) return;
        const st = byCode[code];
        if (!st) {
          probs.push(`แถว ${idx + 2}: ไม่พบรหัส ${code} ในห้องนี้`);
          return;
        }
        const levels = {};
        let days = "";
        let bad = false;
        criteria.forEach((c, i) => {
          const raw = r[colByIdx[i]];
          if (raw === "" || raw === null || raw === undefined) {
            if (c.kind !== "late") levels[c.criterionId] = null;
            return;
          }
          const v = Number(raw);
          if (c.kind === "late") {
            if (!Number.isInteger(v) || v < 0) {
              probs.push(`แถว ${idx + 2} (${st.firstName}): วันส่งช้า "${raw}" ไม่ถูกต้อง (ต้องเป็นจำนวนเต็มตั้งแต่ 0)`);
              bad = true;
              return;
            }
            days = String(v);
          } else {
            if (![1, 2, 3, 4].includes(v)) {
              probs.push(`แถว ${idx + 2} (${st.firstName}): ระดับ "${raw}" ไม่ถูกต้อง (ต้องเป็น 1-4)`);
              bad = true;
              return;
            }
            levels[c.criterionId] = v;
          }
        });
        const any = Object.values(levels).some((x) => x !== null) || days !== "";
        if (!bad && any) updates.push({ id: st.id, levels, days });
      });
      if (probs.length > 0) {
        setProblems(probs);
        return;
      }
      setRatings((prev) => {
        const next = { ...prev };
        updates.forEach((u) => {
          next[u.id] = { levels: u.levels, daysLate: u.days };
        });
        return next;
      });
      setDirty((prev) => {
        const s = new Set(prev);
        updates.forEach((u) => s.add(u.id));
        return s;
      });
      setMsg(`นำเข้าข้อมูล ${updates.length} คนเข้าตารางแล้ว ตรวจสอบแล้วกด "บันทึกคะแนน"`);
    } catch {
      setError("อ่านไฟล์ไม่สำเร็จ ตรวจสอบว่าเป็นไฟล์ .xlsx");
    }
  };

  // ---------- จัดลำดับแถวตามโหมด ----------
  let sections;
  if (mode === "group") {
    sections = groups.map((g) => ({
      key: g.id,
      title: g.name,
      members: students.filter((s) => assign[s.id] === g.id),
      canApply: true,
    }));
    const rest = students.filter((s) => !groups.find((g) => g.id === assign[s.id]));
    if (rest.length > 0) sections.push({ key: "none", title: "ยังไม่มีกลุ่ม", members: rest, canApply: false });
  } else {
    sections = [{ key: "all", title: "", members: students, canApply: false }];
  }

  const cell = { border: `1px solid ${theme.border}`, padding: 8, textAlign: "left", verticalAlign: "middle" };

  const renderRow = (s) => {
    const info = rowInfo(s);
    return (
      <tr key={s.id}>
        <td style={cell}>{s.no}</td>
        <td style={cell}>{nameOf(s)}</td>
        {criteria.map((c) => (
          <td key={c.criterionId} style={cell}>
            {c.kind === "late" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={getRow(s.id).daysLate}
                  onChange={(e) => setDays(s.id, e.target.value)}
                  style={{ ...inputStyle, width: 58, padding: 6 }}
                />
                <span style={{ fontSize: 12, color: theme.muted }}>
                  {levelOf(s, c) !== null ? `ระดับ ${levelOf(s, c)}` : "วัน"}
                </span>
                {subm[s.id] && <span style={{ fontSize: 11, color: theme.muted }}>{submText(subm[s.id])}</span>}
              </div>
            ) : (
              <LevelButtons value={getRow(s.id).levels?.[c.criterionId] ?? null} onPick={(l) => toggleLevel(s.id, c.criterionId, l)} />
            )}
          </td>
        ))}
        <td style={{ ...cell, fontWeight: 700, whiteSpace: "nowrap" }}>
          {info.complete ? (
            `${info.total} / ${maxScore}`
          ) : info.filled > 0 ? (
            <span style={{ color: theme.danger, fontWeight: 400, fontSize: 13 }}>ยังไม่ครบ</span>
          ) : (
            "-"
          )}
        </td>
      </tr>
    );
  };

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าวิชา
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>ให้คะแนนตามเกณฑ์: {assignment.title}</h2>
      <p style={{ margin: "0 0 16px", color: theme.muted, fontSize: 13 }}>คะแนนเต็ม {maxScore}</p>

      {criteria.length === 0 ? (
        <p style={{ color: theme.danger }}>
          ยังไม่ได้ตั้งเกณฑ์ของโปรเจกต์นี้{" "}
          <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}/assignment/${assignmentId}/rubric`}>
            ไปตั้งเกณฑ์ก่อน
          </Link>
        </p>
      ) : (
        <>
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>รูปแบบงาน</h3>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
              <label style={{ cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={mode === "individual"}
                  onChange={() => {
                    setMode("individual");
                    setGroupsDirty(true);
                  }}
                />{" "}
                งานเดี่ยว
              </label>
              <label style={{ cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={mode === "group"}
                  onChange={() => {
                    setMode("group");
                    setGroupsDirty(true);
                    setShowGroupEditor(true);
                  }}
                />{" "}
                งานกลุ่ม
              </label>
            </div>

            {mode === "group" && (
              <div style={{ marginTop: 12 }}>
                <button type="button" style={btnSecondary} onClick={() => setShowGroupEditor((v) => !v)}>
                  {showGroupEditor ? "ซ่อนการจัดกลุ่ม" : `จัดกลุ่ม (${groups.length} กลุ่ม)`}
                </button>
                {showGroupEditor && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      <input
                        placeholder="ชื่อกลุ่ม เช่น กลุ่ม 1"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        style={{ ...inputStyle, width: 180 }}
                      />
                      <button type="button" style={btnSecondary} onClick={addGroup}>+ เพิ่มกลุ่ม</button>
                    </div>
                    {groups.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                        {groups.map((g) => (
                          <span key={g.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 999, padding: "3px 10px", fontSize: 13 }}>
                            {g.name}{" "}
                            <button
                              type="button"
                              onClick={() => removeGroup(g.id)}
                              style={{ border: "none", background: "transparent", color: theme.danger, cursor: "pointer" }}
                              title="ลบกลุ่ม"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ overflowX: "auto", maxHeight: 280, overflowY: "auto" }}>
                      <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 300 }}>
                        <tbody>
                          {students.map((s) => (
                            <tr key={s.id} style={{ borderTop: `1px solid ${theme.border}` }}>
                              <td style={{ padding: "4px 8px" }}>{s.no}</td>
                              <td style={{ padding: "4px 8px" }}>{nameOf(s)}</td>
                              <td style={{ padding: "4px 8px" }}>
                                <select
                                  value={assign[s.id] || ""}
                                  onChange={(e) => setStudentGroup(s.id, e.target.value)}
                                  style={{ ...inputStyle, padding: 4 }}
                                >
                                  <option value="">ไม่มีกลุ่ม</option>
                                  {groups.map((g) => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {groupsDirty && (
              <div style={{ marginTop: 12 }}>
                <button type="button" style={btnPrimary} onClick={saveGroups}>บันทึกรูปแบบงานและกลุ่ม</button>
              </div>
            )}
          </div>

          <details style={{ ...cardStyle, marginBottom: 16 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 15 }}>ดูคำอธิบายแต่ละระดับ</summary>
            <div style={{ marginTop: 10, display: "grid", gap: 12, fontSize: 13 }}>
              {criteria.map((c) => (
                <div key={c.criterionId}>
                  <div style={{ fontWeight: 700 }}>
                    {c.name} ({c.weight}%)
                  </div>
                  {[4, 3, 2, 1].map((l) => (
                    <div key={l}>
                      <b>{l} {LEVEL_LABEL[l]}:</b>{" "}
                      {c.kind === "late" ? lateText(c.lateDays || DEFAULT_LATE_DAYS, l) : c.levels?.[l] || "-"}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>

          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>กรอกจาก Excel (ไม่บังคับ)</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" style={btnSecondary} onClick={downloadTemplate} disabled={students.length === 0}>
                ดาวน์โหลดแม่แบบ (Excel)
              </button>
              <input type="file" accept=".xlsx,.xls" onChange={handleFile} />
            </div>
            <p style={{ margin: "8px 0 0", color: theme.muted, fontSize: 12 }}>
              ช่องระดับกรอก 1-4 ช่องวันส่งช้ากรอกจำนวนวัน (0 = ตรงเวลา) ห้ามแก้รหัสประจำตัวและหัวคอลัมน์ ข้อมูลจะเข้าตารางให้ตรวจก่อน ยังไม่บันทึกจนกว่าจะกดบันทึก
            </p>
          </div>

          {problems.length > 0 && (
            <div style={{ ...cardStyle, marginBottom: 16, borderColor: "#FCA5A5", background: theme.dangerBg }}>
              <b style={{ color: theme.danger }}>พบข้อผิดพลาด {problems.length} จุด แก้ในไฟล์แล้วอัปโหลดใหม่ (ยังไม่มีข้อมูลเข้าตาราง)</b>
              <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 13 }}>
                {problems.slice(0, 10).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
              {problems.length > 10 && <p style={{ fontSize: 13 }}>...และอีก {problems.length - 10} จุด</p>}
            </div>
          )}

          <div style={{ position: "sticky", top: 0, background: theme.bg, padding: "8px 0", zIndex: 1 }}>
            <button style={btnTeal} onClick={save} disabled={busy || dirty.size === 0}>
              {busy ? "กำลังบันทึก..." : `บันทึกคะแนน${dirty.size ? ` (${dirty.size} คนที่แก้)` : ""}`}
            </button>
            {hasLate && (
              <button style={{ ...btnSecondary, marginLeft: 8 }} onClick={fillZeroDays} disabled={busy}>
                ตั้งวันส่งช้า = 0 ให้ทุกคนที่ยังว่าง
              </button>
            )}
            {error && <span style={{ color: theme.danger, marginLeft: 12 }}>{error}</span>}
            {msg && <span style={{ color: theme.success, marginLeft: 12 }}>{msg}</span>}
          </div>

          {mode === "group" && groups.length === 0 && (
            <p style={{ color: theme.muted, fontSize: 13 }}>ยังไม่มีกลุ่ม กด "จัดกลุ่ม" ด้านบนเพื่อสร้างกลุ่มและแบ่งนักเรียน</p>
          )}

          <div style={{ ...cardStyle, overflowX: "auto", padding: 0, marginTop: 12 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  <th style={cell}>เลขที่</th>
                  <th style={cell}>ชื่อ-นามสกุล</th>
                  {criteria.map((c) => (
                    <th key={c.criterionId} style={cell}>
                      {c.name}
                      <div style={{ fontWeight: 400, fontSize: 12, color: theme.muted }}>{c.weight}%</div>
                    </th>
                  ))}
                  <th style={cell}>รวม</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((sec) => (
                  <>
                    {mode === "group" && (
                      <tr key={`h-${sec.key}`} style={{ background: "#EEF6F5" }}>
                        <td style={{ ...cell, fontWeight: 700 }} colSpan={2}>
                          {sec.title} ({sec.members.length} คน)
                        </td>
                        {criteria.map((c) => (
                          <td key={c.criterionId} style={cell}>
                            {sec.canApply &&
                              (c.kind === "late" ? (
                                <button
                                  type="button"
                                  style={{ ...btnSecondary, padding: "4px 8px", fontSize: 12 }}
                                  onClick={() => groupDays(sec.members)}
                                >
                                  ตั้งทั้งกลุ่ม
                                </button>
                              ) : (
                                <LevelButtons
                                  value={null}
                                  onPick={(l) => sec.members.forEach((m) => applyLevel(m.id, c.criterionId, l))}
                                />
                              ))}
                          </td>
                        ))}
                        <td style={cell}></td>
                      </tr>
                    )}
                    {sec.members.map(renderRow)}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          {mode === "group" && (
            <p style={{ color: theme.muted, fontSize: 12 }}>
              กดระดับที่แถวหัวกลุ่มเพื่อตั้งให้ทุกคนในกลุ่ม แล้วปรับรายคนได้ที่แถวของแต่ละคน
            </p>
          )}
        </>
      )}
    </div>
  );
}