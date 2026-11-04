import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query, where, writeBatch, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnTeal, inputStyle } from "../theme";

const NUM = /^-?\d+(\.\d{1,2})?$/;
const STATUS = { assigned: "รอสอบ", started: "กำลังสอบ", submitted: "ส่งแล้ว" };
const toLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function checkSet(j) {
  if (!j || j.format !== "retake-exam-v1" || !j.set?.items?.length) return "ไฟล์ไม่ใช่ข้อสอบซ่อม (retake-exam-v1)";
  for (const it of j.set.items) {
    const at = `ข้อ ${it.no}`;
    if (it.type === "mcq") {
      if ((it.choices || []).length !== 4) return `${at}: ต้องมี 4 ตัวเลือก`;
      if (it.choices.filter((c) => c.isCorrect).length !== 1) return `${at}: ต้องมีเฉลย 1 ตัวเลือก`;
    } else if (it.type === "fill") {
      if (!NUM.test(String(it.answer ?? "").replace(/[$\s]/g, ""))) return `${at}: เฉลยต้องเป็นจำนวนเต็มหรือทศนิยมไม่เกิน 2 ตำแหน่ง`;
    } else return `${at}: ชนิดข้อสอบไม่รองรับ`;
  }
  return "";
}

export default function RetakeSetup() {
  const { classroomId, subjectId, assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [students, setStudents] = useState([]);
  const [scores, setScores] = useState({});
  const [attempts, setAttempts] = useState({});
  const [oldLabels, setOldLabels] = useState([]);
  const [newSets, setNewSets] = useState({});
  const [picked, setPicked] = useState(new Set());
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [duration, setDuration] = useState(60);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const base = ["classrooms", classroomId];

  async function load() {
    try {
      const [a, s, sc, at, ex, pp] = await Promise.all([
        getDoc(doc(db, ...base, "subjects", subjectId, "assignments", assignmentId)),
        getDocs(query(collection(db, ...base, "students"), orderBy("no"))),
        getDocs(query(collection(db, ...base, "scores"), where("assignmentId", "==", assignmentId))),
        getDocs(query(collection(db, ...base, "retakeAttempts"), where("assignmentId", "==", assignmentId))),
        getDoc(doc(db, ...base, "retakeExams", assignmentId)),
        getDoc(doc(db, ...base, "retakePapers", assignmentId)),
      ]);
      if (!a.exists()) return;
      const asg = a.data();
      setAssignment(asg);
      const list = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      setStudents(list);
      const scMap = Object.fromEntries(sc.docs.map((d) => [d.data().studentCode, d.data()]));
      setScores(scMap);
      const atMap = Object.fromEntries(at.docs.map((d) => [d.data().studentCode, d.data()]));
      setAttempts(atMap);
      setPicked(new Set(list.filter((st) => {
        const r = scMap[st.id];
        return r && r.score != null && r.score < asg.maxScore / 2 && r.retakeScore == null && !atMap[st.id];
      }).map((st) => st.id)));
      if (ex.exists()) {
        setOpensAt(toLocal(ex.data().opensAt));
        setClosesAt(toLocal(ex.data().closesAt));
        setDuration(ex.data().durationMin || 60);
      }
      setOldLabels(pp.exists() ? Object.keys(pp.data().sets || {}).sort() : []);
    } catch {
      setError("โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [classroomId, subjectId, assignmentId]);

  if (loading) return <p>กำลังโหลด...</p>;
  if (!assignment) return <p>ไม่พบใบงานนี้</p>;

  async function onFiles(e) {
    setError("");
    const out = {};
    let letter = 0;
    for (const f of [...e.target.files]) {
      try {
        const j = JSON.parse(await f.text());
        const msg = checkSet(j);
        if (msg) return setError(`${f.name}: ${msg}`);
        const label = (j.set.variant || String.fromCharCode(65 + letter)).trim().toUpperCase().slice(0, 4);
        letter++;
        if (out[label]) return setError(`ชื่อชุด "${label}" ซ้ำกัน (${f.name})`);
        out[label] = { items: j.set.items, title: j.set.title };
      } catch (err) {
        return setError(`${f.name}: อ่านไฟล์ไม่ได้`);
      }
    }
    setNewSets(out);
  }

  const toggle = (code) =>
    setPicked((old) => { const n = new Set(old); n.has(code) ? n.delete(code) : n.add(code); return n; });

  const labels = Object.keys(newSets).length ? Object.keys(newSets).sort() : oldLabels;
  const locked = (code) => ["started", "submitted"].includes(attempts[code]?.status);

  async function save() {
    setError(""); setMessage("");
    const replacing = Object.keys(newSets).length > 0;
    if (!labels.length) return setError("กรุณาเลือกไฟล์ข้อสอบซ่อม");
    if (!opensAt || !closesAt) return setError("กรุณากำหนดเวลาเปิด-ปิดการสอบ");
    if (new Date(closesAt) <= new Date(opensAt)) return setError("เวลาปิดต้องหลังเวลาเปิด");
    if (!(Number(duration) > 0)) return setError("กรุณากำหนดระยะเวลาทำข้อสอบ");
    if (replacing && Object.values(attempts).some((a) => ["started", "submitted"].includes(a.status))) {
      return setError("มีนักเรียนเริ่มสอบแล้ว เปลี่ยนชุดข้อสอบไม่ได้");
    }
    const targets = students.filter((s) => picked.has(s.id) && !locked(s.id));
    if (!targets.length) return setError("ไม่มีนักเรียนที่จะแจกข้อสอบ");
    if (replacing && JSON.stringify(newSets).length > 900000) {
      return setError("ไฟล์ข้อสอบใหญ่เกินไป (เอกสารละไม่เกิน 1 MB) ลองลดจำนวนข้อหรือรูป");
    }
    setBusy(true);
    try {
      const batch = writeBatch(db);
      const openIso = new Date(opensAt).toISOString();
      const closeIso = new Date(closesAt).toISOString();
      if (replacing) {
        batch.set(doc(db, ...base, "retakePapers", assignmentId), { assignmentId, sets: newSets, updatedAt: serverTimestamp() });
      }
      batch.set(doc(db, ...base, "retakeExams", assignmentId), {
        assignmentId, subjectId, title: assignment.title, maxScore: assignment.maxScore,
        opensAt: openIso, closesAt: closeIso, durationMin: Number(duration), labels, updatedAt: serverTimestamp(),
      });
      targets.forEach((s, i) => {
        batch.set(doc(db, ...base, "retakeAttempts", `${assignmentId}_${s.id}`), {
          examId: assignmentId, assignmentId, subjectId, studentCode: s.id,
          setLabel: labels[i % labels.length], title: assignment.title, maxScore: assignment.maxScore,
          opensAt: openIso, closesAt: closeIso, durationMin: Number(duration), status: "assigned",
        });
      });
      await batch.commit();
      setNewSets({});
      setMessage(`แจกข้อสอบให้ ${targets.length} คน (ชุด ${labels.join("/")})`);
      await load();
    } catch (e) {
      setError("บันทึกไม่สำเร็จ: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reset(code) {
    if (!window.confirm(`ลบการสอบของรหัส ${code} เพื่อให้สอบใหม่?`)) return;
    const batch = writeBatch(db);
    batch.delete(doc(db, ...base, "retakeAttempts", `${assignmentId}_${code}`));
    await batch.commit();
    await load();
  }

  const cell = { border: `1px solid ${theme.border}`, padding: 8, textAlign: "left" };
  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}`} style={{ color: theme.accent, fontSize: 14 }}>&larr; กลับไปหน้าวิชา</Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>สอบซ่อมออนไลน์: {assignment.title}</h2>
      <p style={{ color: theme.muted }}>คะแนนเต็ม {assignment.maxScore} | ติดซ่อมเมื่อได้ต่ำกว่า {assignment.maxScore / 2}</p>

      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <b>1) ไฟล์ข้อสอบซ่อม</b> (เลือกได้หลายไฟล์ 1 ไฟล์ต่อ 1 ชุด A/B/C)<br />
        <input type="file" accept=".json,application/json" multiple onChange={onFiles} />
        <p style={{ fontSize: 13, color: theme.muted }}>
          {Object.keys(newSets).length
            ? "ชุดที่เลือก: " + Object.entries(newSets).map(([k, v]) => `${k} (${v.items.length} ข้อ)`).join(", ")
            : oldLabels.length ? `ใช้ชุดที่นำเข้าไว้แล้ว: ${oldLabels.join(", ")} (เลือกไฟล์ใหม่เพื่อแทนที่)` : "ยังไม่ได้นำเข้า"}
        </p>
      </div>

      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <b>2) เวลาสอบ</b><br />
        เปิด <input type="datetime-local" style={inputStyle} value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />{" "}
        ปิด <input type="datetime-local" style={inputStyle} value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />{" "}
        ทำได้ <input type="number" min="1" style={{ ...inputStyle, width: 70 }} value={duration} onChange={(e) => setDuration(e.target.value)} /> นาที
      </div>

      <div style={{ ...cardStyle, overflowX: "auto", padding: 0, marginBottom: 12 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ background: "#F9FAFB" }}>
              <th style={cell}>แจก</th><th style={cell}>เลขที่</th><th style={cell}>ชื่อ-นามสกุล</th>
              <th style={cell}>คะแนนสอบ</th><th style={cell}>สถานะ</th><th style={cell}></th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const r = scores[s.id]; const a = attempts[s.id];
              return (
                <tr key={s.id}>
                  <td style={cell}><input type="checkbox" disabled={locked(s.id)} checked={picked.has(s.id)} onChange={() => toggle(s.id)} /></td>
                  <td style={cell}>{s.no}</td>
                  <td style={cell}>{s.prefix}{s.firstName} {s.lastName}</td>
                  <td style={cell}>{r?.score ?? "-"}{r?.retakeScore != null ? ` → ซ่อม ${r.retakeScore}` : ""}</td>
                  <td style={cell}>{a ? `${STATUS[a.status] || a.status} (ชุด ${a.setLabel}${a.status === "submitted" ? `, ได้ ${a.retakeScore}` : ""})` : "-"}</td>
                  <td style={cell}>{a && <button onClick={() => reset(s.id)}>รีเซ็ต</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button style={btnTeal} onClick={save} disabled={busy}>{busy ? "กำลังบันทึก..." : `แจกข้อสอบให้ ${[...picked].filter((c) => !locked(c)).length} คน`}</button>
      {error && <span style={{ color: theme.danger, marginLeft: 12 }}>{error}</span>}
      {message && <span style={{ color: theme.success, marginLeft: 12 }}>{message}</span>}
    </div>
  );
}