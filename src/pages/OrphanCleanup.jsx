import { useState } from "react";
import { Link } from "react-router-dom";
import { collection, collectionGroup, getDocs, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnPrimary, btnSecondary, btnDanger } from "../theme";

const GROUPS = [
  { name: "scores", label: "คะแนนของใบงาน" },
  { name: "attendance", label: "ผลเช็คคาบเรียน" },
  { name: "attendanceLog", label: "บันทึกคาบที่เช็คแล้ว" },
  { name: "attendanceSessions", label: "รอบสแกน QR" },
  { name: "attendanceScans", label: "รายการสแกน QR" },
  { name: "retakeExams", label: "ตั้งค่าสอบซ่อม" },
  { name: "retakePapers", label: "ชุดข้อสอบซ่อม" },
  { name: "retakeAttempts", label: "การแจกข้อสอบซ่อม" },
  { name: "itemAnalysis", label: "โครงข้อสอบ" },
  { name: "itemScores", label: "คะแนนรายข้อ" },
  { name: "rubric", label: "เกณฑ์ประเมินและกลุ่มของโปรเจกต์" },
  { name: "retakeImages", label: "รูปข้อสอบซ่อม" },
];

function collectImageIds(sets) {
  const ids = new Set();
  Object.values(sets || {}).forEach((s) => {
    (s.items || []).forEach((it) => {
      (it.images || []).forEach((im) => im?.imageId && ids.add(im.imageId));
      (it.choices || []).forEach((c) => c?.image?.imageId && ids.add(c.image.imageId));
    });
  });
  return ids;
}

async function deleteRefs(refs, onProgress) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
    onProgress?.(Math.min(i + 400, refs.length), refs.length);
  }
}

export default function OrphanCleanup() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState(null);
  const [includeImages, setIncludeImages] = useState(true);
  const [error, setError] = useState("");
  const [doneMsg, setDoneMsg] = useState("");

  const scan = async () => {
    setBusy(true);
    setError("");
    setDoneMsg("");
    setResults(null);
    try {
      // 1) ข้อมูลอ้างอิง: ห้อง วิชา ใบงาน นักเรียนที่ยังมีอยู่จริง
      setStatus("กำลังอ่านรายการห้อง วิชา ใบงาน และนักเรียน...");
      const classSnap = await getDocs(collection(db, "classrooms"));
      const classIds = new Set(classSnap.docs.map((d) => d.id));
      const subjects = {};
      const students = {};
      const asgBySubject = {};
      const asgAll = {};
      for (const c of classSnap.docs) {
        const [sj, st] = await Promise.all([
          getDocs(collection(db, "classrooms", c.id, "subjects")),
          getDocs(collection(db, "classrooms", c.id, "students")),
        ]);
        subjects[c.id] = new Set(sj.docs.map((d) => d.id));
        students[c.id] = new Set(st.docs.map((d) => d.id));
        asgBySubject[c.id] = {};
        asgAll[c.id] = new Set();
        for (const s of sj.docs) {
          const a = await getDocs(collection(db, "classrooms", c.id, "subjects", s.id, "assignments"));
          asgBySubject[c.id][s.id] = new Set(a.docs.map((d) => d.id));
          a.docs.forEach((d) => asgAll[c.id].add(d.id));
        }
      }

      const referenced = {};
      let papersOk = true;

      const reasonFor = (name, d) => {
        const p = d.ref.path.split("/");
        if (p[0] !== "classrooms") return "";
        const c = p[1];
        if (!classIds.has(c)) return "ห้องเรียนถูกลบแล้ว";
        const v = d.data();
        const hasAsg = (id) => asgAll[c].has(id);
        const hasSubj = (id) => subjects[c].has(id);
        const hasStu = (id) => students[c].has(id);
        switch (name) {
          case "scores":
          case "retakeAttempts":
            if (!hasAsg(v.assignmentId)) return "ใบงานถูกลบแล้ว";
            if (!hasStu(v.studentCode)) return "นักเรียนถูกลบแล้ว";
            return "";
          case "attendance":
            if (!hasSubj(v.subjectId)) return "วิชาถูกลบแล้ว";
            if (!hasStu(v.studentCode)) return "นักเรียนถูกลบแล้ว";
            return "";
          case "attendanceLog":
          case "attendanceSessions":
            return hasSubj(v.subjectId) ? "" : "วิชาถูกลบแล้ว";
          case "attendanceScans": {
            const sid = String(v.sessionId || "").split("_")[0];
            if (!hasSubj(sid)) return "วิชาถูกลบแล้ว";
            if (!hasStu(v.studentCode)) return "นักเรียนถูกลบแล้ว";
            return "";
          }
          case "retakeExams":
          case "retakePapers":
            return hasAsg(d.id) ? "" : "ใบงานถูกลบแล้ว";
          case "itemAnalysis":
          case "itemScores":
          case "rubric": {
            const s = p[3];
            const a = p[5];
            if (!hasSubj(s)) return "วิชาถูกลบแล้ว";
            if (!asgBySubject[c][s]?.has(a)) return "ใบงานถูกลบแล้ว";
            if (name === "itemScores" && !hasStu(d.id)) return "นักเรียนถูกลบแล้ว";
            return "";
          }
          case "retakeImages":
            return referenced[c]?.has(d.id) ? "" : "ไม่มีชุดข้อสอบใดใช้แล้ว";
          default:
            return "";
        }
      };

      const out = [];
      for (const g of GROUPS) {
        if (g.name === "retakeImages" && (!includeImages || !papersOk)) continue;
        setStatus(`กำลังสแกน: ${g.label}...`);
        let snap;
        try {
          snap = await getDocs(collectionGroup(db, g.name));
        } catch {
          out.push({ ...g, total: 0, orphans: [], error: "อ่านไม่ได้ (ยังไม่ได้ publish rules ของ collection group)" });
          if (g.name === "retakePapers") papersOk = false;
          continue;
        }
        const orphans = [];
        let total = 0;
        snap.docs.forEach((d) => {
          if (!d.ref.path.startsWith("classrooms/")) return;
          total += 1;
          const why = reasonFor(g.name, d);
          if (why) {
            orphans.push({ ref: d.ref, path: d.ref.path, reason: why });
          } else if (g.name === "retakePapers") {
            const c = d.ref.path.split("/")[1];
            if (!referenced[c]) referenced[c] = new Set();
            collectImageIds(d.data().sets).forEach((id) => referenced[c].add(id));
          }
        });
        out.push({ ...g, total, orphans, error: "" });
      }

      // 2) รหัสผ่านห้องของห้องที่ไม่มีอยู่แล้ว
      setStatus("กำลังสแกน: รหัสผ่านห้อง...");
      try {
        const sec = await getDocs(collection(db, "classroomSecrets"));
        const orphans = sec.docs
          .filter((d) => !classIds.has(d.id))
          .map((d) => ({ ref: d.ref, path: d.ref.path, reason: "ห้องเรียนถูกลบแล้ว" }));
        out.push({ name: "classroomSecrets", label: "รหัสผ่านห้อง", total: sec.size, orphans, error: "" });
      } catch {
        out.push({ name: "classroomSecrets", label: "รหัสผ่านห้อง", total: 0, orphans: [], error: "อ่านไม่ได้" });
      }

      setResults(out);
      setStatus("");
    } catch (e) {
      setError("สแกนไม่สำเร็จ: " + e.message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const totalOrphans = results ? results.reduce((s, r) => s + r.orphans.length, 0) : 0;

  const removeAll = async () => {
    if (!results || totalOrphans === 0) return;
    if (!window.confirm(`ลบข้อมูลกำพร้า ${totalOrphans} รายการ? การลบนี้กู้คืนไม่ได้`)) return;
    setBusy(true);
    setError("");
    try {
      const refs = results.flatMap((r) => r.orphans.map((o) => o.ref));
      await deleteRefs(refs, (done, all) => setStatus(`กำลังลบ ${done}/${all}...`));
      setDoneMsg(`ลบแล้ว ${refs.length} รายการ แนะนำให้กดสแกนอีกรอบเพื่อยืนยันว่าไม่เหลือ`);
      setResults(null);
    } catch (e) {
      setError("ลบไม่สำเร็จ: " + e.message);
    } finally {
      setStatus("");
      setBusy(false);
    }
  };

  const reasonCounts = (orphans) => {
    const m = {};
    orphans.forEach((o) => {
      m[o.reason] = (m[o.reason] || 0) + 1;
    });
    return Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ");
  };

  return (
    <div>
      <Link to="/teacher" style={{ color: theme.accent, fontSize: 14 }}>&larr; กลับหน้าหลัก</Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>ตรวจหาข้อมูลกำพร้า</h2>
      <p style={{ margin: "0 0 16px", color: theme.muted, fontSize: 13 }}>
        สแกนทุกห้อง หาข้อมูลที่ห้อง วิชา ใบงาน หรือนักเรียนที่อ้างถึงถูกลบไปแล้ว การสแกนยังไม่ลบอะไร ลบเมื่อคุณกดยืนยันเท่านั้น
      </p>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <label style={{ fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} /> ตรวจรูปข้อสอบซ่อมด้วย (อ่านข้อมูลรูปทั้งหมด อาจช้ากว่า)
        </label>
        <div style={{ marginTop: 12 }}>
          <button type="button" style={btnPrimary} onClick={scan} disabled={busy}>
            {busy && status ? "กำลังทำงาน..." : "สแกนหาข้อมูลกำพร้า"}
          </button>
        </div>
        {status && <p style={{ margin: "10px 0 0", color: theme.muted, fontSize: 13 }}>{status}</p>}
      </div>

      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {doneMsg && <p style={{ color: theme.success }}>{doneMsg}</p>}

      {results && (
        <>
          <p style={{ fontSize: 15 }}>
            {totalOrphans === 0 ? (
              <b style={{ color: theme.success }}>ไม่พบข้อมูลกำพร้า</b>
            ) : (
              <b>พบข้อมูลกำพร้ารวม {totalOrphans} รายการ</b>
            )}
          </p>
          <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            {results.map((r) => (
              <div key={r.name} style={{ ...cardStyle, padding: 14 }}>
                <div style={{ fontWeight: 700 }}>
                  {r.label}{" "}
                  <span style={{ fontWeight: 400, color: theme.muted, fontSize: 13 }}>
                    (พบ {r.orphans.length} จากทั้งหมด {r.total})
                  </span>
                </div>
                {r.error && <div style={{ color: theme.danger, fontSize: 13 }}>{r.error}</div>}
                {r.orphans.length > 0 && (
                  <>
                    <div style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>{reasonCounts(r.orphans)}</div>
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ cursor: "pointer", fontSize: 13 }}>ดูตัวอย่างเส้นทางเอกสาร</summary>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, wordBreak: "break-all" }}>
                        {r.orphans.slice(0, 5).map((o) => (
                          <li key={o.path}>{o.path}</li>
                        ))}
                      </ul>
                    </details>
                  </>
                )}
              </div>
            ))}
          </div>
          {totalOrphans > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={btnDanger} onClick={removeAll} disabled={busy}>
                ลบข้อมูลกำพร้าทั้งหมด ({totalOrphans})
              </button>
              <button type="button" style={btnSecondary} onClick={() => setResults(null)} disabled={busy}>
                ปิดผลสแกน (ไม่ลบ)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}