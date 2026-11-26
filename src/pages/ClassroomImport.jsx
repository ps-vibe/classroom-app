import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { collection, doc, getDoc, getDocs, writeBatch, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { ASSIGNMENT_TYPES, typeLabel } from "../constants";
import { theme, cardStyle, btnPrimary, btnSecondary, inputStyle } from "../theme";

const norm = (s) => String(s ?? "").trim();

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.trim().toLowerCase()));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function classify(headers) {
  const h = headers.map((x) => String(x).trim().toLowerCase());
  const has = (n) => h.includes(n);
  if (has("student email") && has("coursework id")) return "submissions";
  if (has("coursework id") && has("title") && has("due date")) return "coursework";
  return "";
}

const g = (row, ...names) => {
  for (const k of Object.keys(row)) {
    if (names.includes(k.trim().toLowerCase())) return norm(row[k]);
  }
  return "";
};

const parseDT = (s) => {
  const str = String(s || "").trim();
  if (!str) return null;
  let y;
  let mo;
  let d;
  let rest;
  let m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
    rest = str.slice(m[0].length);
  } else {
    m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    y = Number(m[3]);
    // ปกติอ่านเป็น วัน-เดือน-ปี ยกเว้นตัวที่สองมากกว่า 12 ให้อ่านเป็น เดือน-วัน-ปี
    if (b > 12 && a <= 12) {
      mo = a;
      d = b;
    } else {
      d = a;
      mo = b;
    }
    rest = str.slice(m[0].length);
  }
  if (y < 100) y += 2000;
  if (y > 2400) y -= 543;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = rest.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hh = t ? Number(t[1]) : 0;
  const mi = t ? Number(t[2]) : 0;
  const ss = t && t[3] ? Number(t[3]) : 0;
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${y}-${pad(mo)}-${pad(d)}`,
    ms: new Date(y, mo - 1, d, hh, mi, ss).getTime(),
  };
};

const dayDiff = (a, b) => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
};

const stateOf = (s) => {
  const v = String(s).toUpperCase();
  if (v === "TURNED_IN") return "submitted";
  if (v === "RETURNED") return "returned";
  return "not_submitted";
};
const STATE_TH = { submitted: "ส่งแล้ว", returned: "คืนงานแล้ว", not_submitted: "ยังไม่ส่ง" };

function guessType(title) {
  const t = title.toLowerCase();
  if (/\[project\]|โปรเจ/.test(t)) return "project";
  if (/กลางภาค/.test(t)) return "midterm";
  if (/ปลายภาค/.test(t)) return "final";
  if (/quiz|ควิซ/.test(t)) return "quiz";
  if (/ชีท|ใบงาน/.test(t)) return "worksheet";
  if (/หนังสือ|เล่ม/.test(t)) return "book";
  return "other";
}

const simple = (s) => String(s).toLowerCase().replace(/[\s()[\]_\-]/g, "");

function bestMatch(title, candidates) {
  const t = simple(title);
  if (!t) return null;
  return (
    candidates.find((a) => simple(a.title) === t) ||
    candidates.find((a) => {
      const x = simple(a.title);
      return x.length >= 4 && (x.includes(t) || t.includes(x));
    }) ||
    null
  );
}

export default function ClassroomImport() {
  const { classroomId } = useParams();
  const [roomName, setRoomName] = useState("");
  const [students, setStudents] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [savedMap, setSavedMap] = useState({});
  const [data, setData] = useState(null);
  const [courseChoice, setCourseChoice] = useState({});
  const [emailMap, setEmailMap] = useState({});
  const [guessed, setGuessed] = useState(new Set());
  const [cwOver, setCwOver] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const col = (...p) => collection(db, "classrooms", classroomId, ...p);

  async function loadBase() {
    try {
      const [roomSnap, stSnap, sjSnap, gcSnap] = await Promise.all([
        getDoc(doc(db, "classrooms", classroomId)),
        getDocs(col("students")),
        getDocs(col("subjects")),
        getDocs(col("gcStudents")),
      ]);
      const subj = [];
      for (const s of sjSnap.docs) {
        const aSnap = await getDocs(col("subjects", s.id, "assignments"));
        subj.push({
          id: s.id,
          name: s.data().name || s.id,
          gcCourseId: s.data().gcCourseId || "",
          gcSkipped: s.data().gcSkipped || [],
          assignments: aSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        });
      }
      setRoomName(roomSnap.exists() ? roomSnap.data().name || "" : "");
      setStudents(stSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.no || 0) - (b.no || 0)));
      setSubjects(subj);
      const m = {};
      gcSnap.docs.forEach((d) => {
        m[d.id] = d.data().studentCode;
      });
      setSavedMap(m);
    } catch {
      setError("โหลดข้อมูลไม่สำเร็จ (ถ้าขึ้นว่าไม่มีสิทธิ์ ให้ตรวจ Firestore rules ของ submissions และ gcStudents)");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId]);

  const nameOf = (s) => `${s.prefix || ""}${s.firstName || ""} ${s.lastName || ""}`.trim();

  async function onFiles(e) {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length === 0) return;
    setError("");
    setMsg("");
    setData(null);
    setCwOver({});
    try {
      const subsRaw = [];
      const worksRaw = [];
      for (const f of files) {
        const isCsv = /\.csv$/i.test(f.name);
        const wb = isCsv
          ? XLSX.read(await f.text(), { type: "string", raw: true })
          : XLSX.read(await f.arrayBuffer(), { type: "array" });
        for (const sn of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: "", raw: false });
          if (rows.length === 0) continue;
          const kind = classify(Object.keys(rows[0]));
          if (kind === "submissions") subsRaw.push(...rows);
          else if (kind === "coursework") worksRaw.push(...rows);
        }
      }
      if (subsRaw.length === 0) {
        setError("ไม่พบข้อมูลการส่งงานในไฟล์ (ต้องมีคอลัมน์ Student Email และ Coursework ID) ให้ใช้แท็บการส่งงานของชีต");
        return;
      }
      const hashCache = {};
      const subs = [];
      for (const r of subsRaw) {
        const email = g(r, "student email").toLowerCase();
        if (!email) continue;
        if (!hashCache[email]) hashCache[email] = await sha256(email);
        subs.push({
          courseId: g(r, "course id"),
          courseName: g(r, "course name"),
          section: g(r, "section"),
          cwId: g(r, "coursework id"),
          title: g(r, "assignment title", "title"),
          name: g(r, "student name"),
          email,
          hash: hashCache[email],
          state: stateOf(g(r, "submission state")),
          lateFlag: /late|ส่งช้า/i.test(g(r, "late")),
          upd: parseDT(g(r, "update time")),
        });
      }
      const works = worksRaw.map((r) => ({
        courseId: g(r, "course id"),
        courseName: g(r, "course name"),
        cwId: g(r, "coursework id"),
        title: g(r, "title"),
        due: parseDT(g(r, "due date"))?.date || "",
      }));
      const courses = {};
      subs.forEach((r) => {
        if (!courses[r.courseId]) courses[r.courseId] = { id: r.courseId, name: r.courseName, section: r.section };
      });
      works.forEach((w) => {
        if (!courses[w.courseId]) courses[w.courseId] = { id: w.courseId, name: w.courseName, section: "" };
      });

      const cc = {};
      Object.keys(courses).forEach((id) => {
        cc[id] = subjects.find((s) => s.gcCourseId === id)?.id || "";
      });
      setCourseChoice(cc);

      const em = {};
      const guess = new Set();
      subs.forEach((r) => {
        if (em[r.hash] !== undefined) return;
        if (savedMap[r.hash]) {
          em[r.hash] = savedMap[r.hash];
          return;
        }
        const m = r.name.match(/^\s*(\d{1,2})(?!\d)/);
        const st = m ? students.find((s) => Number(s.no) === Number(m[1])) : null;
        em[r.hash] = st ? st.id : "";
        if (st) guess.add(r.hash);
      });
      setEmailMap(em);
      setGuessed(guess);
      setData({ subs, works, courses });
    } catch (err) {
      setError("อ่านไฟล์ไม่สำเร็จ: " + err.message);
    }
  }

  // ---------- ข้อมูลที่คำนวณจากไฟล์ ----------
  const subjectById = Object.fromEntries(subjects.map((s) => [s.id, s]));
  const courseList = data ? Object.values(data.courses) : [];
  const mappedCourses = courseList.filter((c) => courseChoice[c.id]);
  const subjectUsedTwice = (() => {
    const seen = {};
    for (const c of mappedCourses) {
      const s = courseChoice[c.id];
      if (seen[s]) return true;
      seen[s] = 1;
    }
    return false;
  })();

  const emailRows = {};
  if (data) {
    data.subs.forEach((r) => {
      if (courseChoice[r.courseId] && !emailRows[r.hash]) emailRows[r.hash] = { hash: r.hash, email: r.email, name: r.name };
    });
  }
  const emailList = Object.values(emailRows);

  const cwItems = [];
  if (data) {
    mappedCourses.forEach((c) => {
      const subj = subjectById[courseChoice[c.id]];
      const ids = new Map();
      data.works
        .filter((w) => w.courseId === c.id)
        .forEach((w) => ids.set(w.cwId, { title: w.title, due: w.due }));
      data.subs
        .filter((r) => r.courseId === c.id)
        .forEach((r) => {
          if (!ids.has(r.cwId)) ids.set(r.cwId, { title: r.title, due: "" });
        });
      ids.forEach((v, cwId) => {
        cwItems.push({
          courseId: c.id,
          subjectId: subj.id,
          cwId,
          title: v.title,
          due: v.due,
          count: data.subs.filter((r) => r.cwId === cwId).length,
        });
      });
    });
    cwItems.sort((a, b) => String(b.due).localeCompare(String(a.due)));
  }

  const unlinkedOf = (subj, exceptCwId) =>
    subj.assignments.filter((a) => !a.gcCourseworkId || a.gcCourseworkId === exceptCwId);

  const choiceOf = (it) => {
    const subj = subjectById[it.subjectId];
    const o = cwOver[it.cwId] || {};
    const linked = subj.assignments.find((a) => a.gcCourseworkId === it.cwId);
    const skipped = subj.gcSkipped.includes(it.cwId);
    const match = bestMatch(it.title, unlinkedOf(subj, it.cwId).filter((a) => !a.gcCourseworkId));
    let action = o.action;
    if (!action) {
      if (linked) action = "keep";
      else if (skipped) action = "skip";
      else if (/ค้างส่ง|ซ่อม/.test(it.title)) action = "skip";
      else action = match ? "link" : "create";
    }
    return {
      action,
      assignmentId: o.assignmentId ?? match?.id ?? "",
      title: o.title ?? it.title,
      type: o.type ?? guessType(it.title),
      maxScore: o.maxScore ?? "",
      due: o.due ?? it.due,
      linkedId: linked?.id || "",
    };
  };

  const setCw = (cwId, patch) => setCwOver((prev) => ({ ...prev, [cwId]: { ...(prev[cwId] || {}), ...patch } }));

  const onAction = (it, action) => {
    const subj = subjectById[it.subjectId];
    const first = bestMatch(it.title, unlinkedOf(subj, it.cwId).filter((a) => !a.gcCourseworkId)) || unlinkedOf(subj, it.cwId)[0];
    setCw(it.cwId, { action, assignmentId: cwOver[it.cwId]?.assignmentId ?? first?.id ?? "" });
  };

  // ---------- ตรวจความถูกต้องก่อนนำเข้า ----------
  const resolved = {};
  cwItems.forEach((it) => {
    resolved[it.cwId] = choiceOf(it);
  });
  const errors = [];
  if (subjectUsedTwice) errors.push("มี Course ID สองรายการที่เลือกวิชาเดียวกัน");
  const usedAssignments = {};
  cwItems.forEach((it) => {
    const ch = resolved[it.cwId];
    if (ch.action === "link") {
      if (!ch.assignmentId) errors.push(`"${it.title}": ยังไม่ได้เลือกใบงานที่จะผูก`);
      else if (usedAssignments[ch.assignmentId]) errors.push(`"${it.title}": ใบงานที่เลือกถูกใช้กับงานอื่นแล้ว`);
      else usedAssignments[ch.assignmentId] = true;
    }
    if (ch.action === "create") {
      if (!norm(ch.title)) errors.push(`"${it.title}": ยังไม่ได้ตั้งชื่อใบงาน`);
      if (!(Number(ch.maxScore) > 0)) errors.push(`"${it.title}": ใส่คะแนนเต็มของใบงานใหม่ (มากกว่า 0)`);
    }
  });

  const statsOf = (it) => {
    const rows = data.subs.filter((r) => r.cwId === it.cwId);
    const out = { submitted: 0, returned: 0, not_submitted: 0, unmatched: 0 };
    rows.forEach((r) => {
      if (!emailMap[r.hash]) out.unmatched += 1;
      else out[r.state] += 1;
    });
    return out;
  };

  const importable = cwItems.filter((it) => resolved[it.cwId].action !== "skip");
  const unmatchedEmails = emailList.filter((e) => !emailMap[e.hash]).length;
  const canImport = !!data && mappedCourses.length > 0 && errors.length === 0 && importable.length > 0 && !busy;

  // ---------- นำเข้า ----------
  async function doImport() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const ops = [];

      // วิชา: จำ Course ID และรายการงานที่ข้าม
      mappedCourses.forEach((c) => {
        const subj = subjectById[courseChoice[c.id]];
        const items = cwItems.filter((i) => i.courseId === c.id);
        const fileIds = items.map((i) => i.cwId);
        const skipSet = new Set(subj.gcSkipped.filter((id) => !fileIds.includes(id)));
        items.forEach((i) => {
          if (resolved[i.cwId].action === "skip") skipSet.add(i.cwId);
        });
        ops.push((b) => b.update(doc(db, "classrooms", classroomId, "subjects", subj.id), { gcCourseId: c.id, gcSkipped: [...skipSet] }));
      });

      // ใบงาน: ผูกหรือสร้างใหม่
      const assignmentOf = {};
      const dueOf = {};
      cwItems.forEach((it) => {
        const ch = resolved[it.cwId];
        const subj = subjectById[it.subjectId];
        if (ch.action === "keep") {
          assignmentOf[it.cwId] = ch.linkedId;
          dueOf[it.cwId] = it.due || subj.assignments.find((a) => a.id === ch.linkedId)?.dueDate || "";
        } else if (ch.action === "link") {
          assignmentOf[it.cwId] = ch.assignmentId;
          dueOf[it.cwId] = it.due || subj.assignments.find((a) => a.id === ch.assignmentId)?.dueDate || "";
          ops.push((b) =>
            b.update(doc(db, "classrooms", classroomId, "subjects", subj.id, "assignments", ch.assignmentId), {
              gcCourseworkId: it.cwId,
            })
          );
        } else if (ch.action === "create") {
          const ref = doc(collection(db, "classrooms", classroomId, "subjects", subj.id, "assignments"));
          assignmentOf[it.cwId] = ref.id;
          dueOf[it.cwId] = ch.due || "";
          ops.push((b) =>
            b.set(ref, {
              title: norm(ch.title),
              type: ch.type,
              maxScore: Number(ch.maxScore),
              dueDate: ch.due || "",
              createdAt: serverTimestamp(),
              gcCourseworkId: it.cwId,
            })
          );
        }
      });

      // จับคู่นักเรียน (เก็บแฮชของอีเมล)
      emailList.forEach((e) => {
        const code = emailMap[e.hash];
        if (code) {
          ops.push((b) => b.set(doc(col("gcStudents"), e.hash), { studentCode: code, updatedAt: serverTimestamp() }));
        } else if (savedMap[e.hash]) {
          ops.push((b) => b.delete(doc(col("gcStudents"), e.hash)));
        }
      });

      // สถานะการส่งงาน
      let written = 0;
      let unmatched = 0;
      data.subs.forEach((r) => {
        if (!courseChoice[r.courseId]) return;
        const ch = resolved[r.cwId];
        if (!ch || ch.action === "skip") return;
        const code = emailMap[r.hash];
        if (!code) {
          unmatched += 1;
          return;
        }
        const aId = assignmentOf[r.cwId];
        const due = dueOf[r.cwId];
        let daysLate = null;
        if (r.state === "submitted") {
          if (!r.lateFlag) daysLate = 0;
          else if (due && r.upd) daysLate = Math.max(1, dayDiff(r.upd.date, due));
        }
        const subjId = courseChoice[r.courseId];
        ops.push((b) =>
          b.set(doc(col("submissions"), `${aId}_${code}`), {
            assignmentId: aId,
            subjectId: subjId,
            studentCode: code,
            gcCourseworkId: r.cwId,
            state: r.state,
            lateFlag: r.lateFlag,
            turnedInAt: r.state === "submitted" && r.upd ? new Date(r.upd.ms).toISOString() : null,
            gcUpdatedAt: r.upd ? new Date(r.upd.ms).toISOString() : null,
            daysLate,
            importedAt: serverTimestamp(),
          })
        );
        written += 1;
      });

      for (let i = 0; i < ops.length; i += 400) {
        const batch = writeBatch(db);
        ops.slice(i, i + 400).forEach((fn) => fn(batch));
        await batch.commit();
      }
      setCwOver({});
      await loadBase();
      setMsg(`นำเข้าแล้ว: บันทึกสถานะการส่งงาน ${written} รายการ` + (unmatched ? ` · ข้าม ${unmatched} แถวที่ยังไม่ได้จับคู่อีเมล` : ""));
    } catch (e) {
      setError("นำเข้าไม่สำเร็จ: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  const th = { padding: "4px 8px", textAlign: "left", color: theme.muted, fontWeight: 600, fontSize: 12 };
  const td = { padding: "6px 8px", verticalAlign: "top", fontSize: 13 };
  const courseLabel = (c) => `${c.name || "-"}${c.section && c.section !== "-" ? " " + c.section : ""} (${c.id})`;

  return (
    <div>
      <Link to="/teacher" style={{ color: theme.accent, fontSize: 14 }}>&larr; กลับหน้าหลัก</Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>นำเข้าสถานะการส่งงานจาก Google Classroom{roomName ? `: ${roomName}` : ""}</h2>
      <p style={{ margin: "0 0 16px", color: theme.muted, fontSize: 13 }}>
        อ่านไฟล์ในเบราว์เซอร์นี้ เก็บเฉพาะสถานะการส่งงานและแฮชของอีเมล ไม่เก็บอีเมลจริงของนักเรียนลงฐานข้อมูล
      </p>

      {loading && <p style={{ color: theme.muted }}>กำลังโหลด...</p>}
      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {msg && <p style={{ color: theme.success }}>{msg}</p>}

      {!loading && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>1. เลือกไฟล์จากชีต</h3>
          <p style={{ margin: "0 0 10px", color: theme.muted, fontSize: 13 }}>
            ดาวน์โหลดชีตเป็น Excel (.xlsx ทั้งสมุด) หรือ CSV ของแท็บ "งาน" และแท็บ "การส่งงาน" (เลือกหลายไฟล์พร้อมกันได้) ไม่ใช้ไฟล์ PDF
          </p>
          <input type="file" accept=".xlsx,.xls,.csv" multiple onChange={onFiles} />
          {data && (
            <p style={{ margin: "8px 0 0", fontSize: 13, color: theme.muted }}>
              อ่านได้ {data.subs.length} แถวการส่งงาน · {data.works.length} งาน · {courseList.length} รายวิชา
              {data.works.length === 0 && " · ไม่พบแท็บงาน จึงไม่มีวันกำหนดส่งจาก Classroom (ใช้วันกำหนดส่งของใบงานในระบบแทนถ้ามี)"}
            </p>
          )}
        </div>
      )}

      {data && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>2. จับคู่รายวิชา</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {courseList.map((c) => (
              <div key={c.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 14 }}>
                <span style={{ minWidth: 200 }}>{courseLabel(c)}</span>
                <span>→</span>
                <select
                  value={courseChoice[c.id] || ""}
                  onChange={(e) => setCourseChoice((p) => ({ ...p, [c.id]: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">ไม่นำเข้า (ไม่ใช่วิชาของห้องนี้)</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {subjectUsedTwice && <p style={{ color: theme.danger, fontSize: 13 }}>มี Course ID สองรายการที่เลือกวิชาเดียวกัน</p>}
        </div>
      )}

      {data && emailList.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>3. จับคู่นักเรียน ({emailList.length - unmatchedEmails}/{emailList.length} คน)</h3>
          <p style={{ margin: "0 0 10px", color: theme.muted, fontSize: 13 }}>
            ป้ายสีเหลืองคือค่าที่ระบบเดาจากเลขที่หน้าชื่อ ตรวจให้ถูกก่อนกดนำเข้า ที่เหลือว่างจะถูกข้าม
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: 420 }}>
              <thead>
                <tr>
                  <th style={th}>ชื่อใน Classroom</th>
                  <th style={th}>อีเมล</th>
                  <th style={th}>นักเรียนในระบบ</th>
                </tr>
              </thead>
              <tbody>
                {emailList.map((e) => (
                  <tr key={e.hash} style={{ borderTop: `1px solid ${theme.border}` }}>
                    <td style={td}>{e.name || "-"}</td>
                    <td style={{ ...td, color: theme.muted, wordBreak: "break-all" }}>{e.email}</td>
                    <td style={td}>
                      <select
                        value={emailMap[e.hash] || ""}
                        onChange={(ev) => {
                          setEmailMap((p) => ({ ...p, [e.hash]: ev.target.value }));
                          setGuessed((p) => {
                            const n = new Set(p);
                            n.delete(e.hash);
                            return n;
                          });
                        }}
                        style={{
                          ...inputStyle,
                          padding: 5,
                          background: guessed.has(e.hash) ? "#FEF3C7" : emailMap[e.hash] ? "#fff" : "#FEF2F2",
                        }}
                      >
                        <option value="">-- ยังไม่จับคู่ --</option>
                        {students.map((s) => (
                          <option key={s.id} value={s.id}>{s.no}. {nameOf(s)}</option>
                        ))}
                      </select>
                      {guessed.has(e.hash) && <span style={{ fontSize: 11, color: "#92400E" }}> เดาจากเลขที่</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && cwItems.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>4. จับคู่งาน ({cwItems.length} งาน)</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {cwItems.map((it) => {
              const ch = resolved[it.cwId];
              const subj = subjectById[it.subjectId];
              const st = statsOf(it);
              const options = unlinkedOf(subj, it.cwId);
              return (
                <div key={it.cwId} style={{ border: `1px solid ${theme.border}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {it.title || it.cwId}{" "}
                    <span style={{ fontWeight: 400, color: theme.muted, fontSize: 12 }}>กำหนดส่ง {it.due || "-"} · {it.count} แถว</span>
                  </div>
                  <div style={{ fontSize: 12, color: theme.muted, margin: "2px 0 6px" }}>
                    ส่งแล้ว {st.submitted} · คืนงานแล้ว {st.returned} · ยังไม่ส่ง {st.not_submitted}
                    {st.unmatched > 0 && <span style={{ color: "#B45309" }}> · ไม่พบอีเมลที่จับคู่ {st.unmatched}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select value={ch.action} onChange={(e) => onAction(it, e.target.value)} style={inputStyle}>
                      {ch.linkedId && <option value="keep">ใช้ใบงานที่ผูกไว้แล้ว</option>}
                      <option value="link">ผูกกับใบงานที่มีอยู่</option>
                      <option value="create">สร้างใบงานใหม่</option>
                      <option value="skip">ข้าม (ไม่นำเข้า)</option>
                    </select>
                    {ch.action === "keep" && (
                      <span style={{ fontSize: 13 }}>
                        → {subj.assignments.find((a) => a.id === ch.linkedId)?.title || ch.linkedId}
                      </span>
                    )}
                    {ch.action === "link" && (
                      <select value={ch.assignmentId} onChange={(e) => setCw(it.cwId, { assignmentId: e.target.value })} style={inputStyle}>
                        <option value="">-- เลือกใบงาน --</option>
                        {options.map((a) => (
                          <option key={a.id} value={a.id}>{a.title} ({typeLabel(a.type)})</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {ch.action === "create" && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                      <input value={ch.title} onChange={(e) => setCw(it.cwId, { title: e.target.value })} placeholder="ชื่อใบงาน" style={{ ...inputStyle, minWidth: 200 }} />
                      <select value={ch.type} onChange={(e) => setCw(it.cwId, { type: e.target.value })} style={inputStyle}>
                        {ASSIGNMENT_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={ch.maxScore}
                        onChange={(e) => setCw(it.cwId, { maxScore: e.target.value })}
                        placeholder="คะแนนเต็ม"
                        style={{ ...inputStyle, width: 100 }}
                      />
                      <input type="date" value={ch.due} onChange={(e) => setCw(it.cwId, { due: e.target.value })} style={inputStyle} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>5. นำเข้า</h3>
          {errors.length > 0 && (
            <ul style={{ margin: "0 0 10px", paddingLeft: 20, color: theme.danger, fontSize: 13 }}>
              {errors.slice(0, 8).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
              {errors.length > 8 && <li>...และอีก {errors.length - 8} รายการ</li>}
            </ul>
          )}
          <p style={{ margin: "0 0 10px", fontSize: 14 }}>
            จะนำเข้า {importable.length} งาน · ข้าม {cwItems.length - importable.length} งาน
            {unmatchedEmails > 0 && <span style={{ color: "#B45309" }}> · นักเรียน {unmatchedEmails} คนยังไม่ได้จับคู่ (แถวของคนเหล่านี้จะถูกข้าม)</span>}
          </p>

          {(() => {
            const noTime = data.subs.filter(
              (r) =>
                courseChoice[r.courseId] &&
                resolved[r.cwId] &&
                resolved[r.cwId].action !== "skip" &&
                r.state === "submitted" &&
                !r.upd
            ).length;
            const noDue = cwItems.filter((it) => {
              const ch = resolved[it.cwId];
              if (ch.action === "skip") return false;
              const subj = subjectById[it.subjectId];
              const aId = ch.action === "keep" ? ch.linkedId : ch.assignmentId;
              const due =
                it.due ||
                (ch.action === "create" ? ch.due : subj.assignments.find((a) => a.id === aId)?.dueDate) ||
                "";
              return !due && data.subs.some((r) => r.cwId === it.cwId && r.state === "submitted" && r.lateFlag);
            });
            return (
              <>
                {noTime > 0 && (
                  <p style={{ color: "#B45309", fontSize: 13, margin: "0 0 10px" }}>
                    มี {noTime} แถวที่อ่านเวลาส่งไม่ได้ (รูปแบบต้องเป็น 2026-11-23 20:00:00) จำนวนวันส่งช้าของแถวเหล่านี้จะว่าง
                  </p>
                )}
                {noDue.length > 0 && (
                  <p style={{ color: "#B45309", fontSize: 13, margin: "0 0 10px" }}>
                    งานเหล่านี้ไม่มีวันกำหนดส่ง จึงคำนวณจำนวนวันส่งช้าไม่ได้: {noDue.map((x) => x.title || x.cwId).join(", ")}
                    {" "}(เลือกไฟล์แท็บงานมาด้วย หรือใส่วันที่ในช่องวันที่ของงานที่สร้างใหม่)
                  </p>
                )}
              </>
            );
          })()}

          <button type="button" style={btnPrimary} onClick={doImport} disabled={!canImport}>
            {busy ? "กำลังนำเข้า..." : "นำเข้าสถานะการส่งงาน"}
          </button>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: theme.muted }}>
            นำเข้าซ้ำได้ ระบบเขียนทับสถานะเดิมของงานเดียวกัน ส่วนจำนวนวันส่งช้า: ส่งแล้วและติดธงส่งช้า = จำนวนวันจากวันกำหนดส่ง (อย่างน้อย 1) · ส่งแล้วไม่ติดธง = 0 · คืนงานแล้ว = ไม่ทราบ (กรอกเอง)
          </p>
        </div>
      )}
    </div>
  );
}