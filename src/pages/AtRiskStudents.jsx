import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { ASSIGNMENT_TYPES } from "../constants";
import { theme, cardStyle, btnSecondary, inputStyle } from "../theme";

const round1 = (n) => Math.round(n * 10) / 10;
const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const isExamType = (t) => !!ASSIGNMENT_TYPES.find((x) => x.value === t)?.isExam;

const FLAG_STYLE = {
  ค้างส่งงาน: { bg: "#FEF3C7", color: "#92400E" },
  ติดซ่อมค้าง: { bg: "#FEE2E2", color: "#B91C1C" },
  เข้าเรียนต่ำ: { bg: "#FEF3C7", color: "#92400E" },
  คะแนนต่ำ: { bg: "#FEE2E2", color: "#B91C1C" },
};

const groupBySubject = (list, fmt) => {
  const m = {};
  list.forEach((x) => {
    if (!m[x.subject]) m[x.subject] = [];
    m[x.subject].push(fmt(x));
  });
  return Object.entries(m).map(([k, v]) => `${k}: ${v.join(", ")}`);
};

export default function AtRiskStudents() {
  const { classroomId } = useParams();
  const [roomName, setRoomName] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missingMin, setMissingMin] = useState("2");
  const [attMin, setAttMin] = useState("80");
  const [scoreMin, setScoreMin] = useState("50");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [onlyFlagged, setOnlyFlagged] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const col = (...p) => collection(db, "classrooms", classroomId, ...p);
        const [roomSnap, stSnap, sjSnap, scSnap, atSnap, lgSnap] = await Promise.all([
          getDoc(doc(db, "classrooms", classroomId)),
          getDocs(col("students")),
          getDocs(col("subjects")),
          getDocs(col("scores")),
          getDocs(col("attendance")),
          getDocs(col("attendanceLog")),
        ]);
        const subjects = [];
        for (const s of sjSnap.docs) {
          const aSnap = await getDocs(col("subjects", s.id, "assignments"));
          subjects.push({
            id: s.id,
            name: s.data().name || s.id,
            assignments: aSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          });
        }
        if (cancelled) return;
        setRoomName(roomSnap.exists() ? roomSnap.data().name || "" : "");
        setData({
          students: stSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.no || 0) - (b.no || 0)),
          subjects,
          scores: scSnap.docs.map((d) => d.data()),
          attendance: atSnap.docs.map((d) => d.data()),
          logs: lgSnap.docs.map((d) => d.data()),
        });
      } catch {
        if (!cancelled) setError("โหลดข้อมูลไม่สำเร็จ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classroomId]);

  if (loading) return <p>กำลังโหลด...</p>;

  const th = {
    missing: Math.max(1, Number(missingMin) || 1),
    att: Number(attMin) || 0,
    score: Number(scoreMin) || 0,
  };
  const today = todayLocal();

  let rows = [];
  if (data) {
    const scoreMap = {};
    data.scores.forEach((sc) => {
      scoreMap[`${sc.assignmentId}_${sc.studentCode}`] = sc;
    });
    const subjList = subjectFilter === "all" ? data.subjects : data.subjects.filter((s) => s.id === subjectFilter);

    rows = data.students.map((st) => {
      const missingList = [];
      const retakeList = [];
      const attLow = [];
      const scoreLow = [];

      subjList.forEach((subj) => {
        let sumScore = 0;
        let sumMax = 0;
        subj.assignments.forEach((a) => {
          const sc = scoreMap[`${a.id}_${st.id}`];
          const has = !!sc && sc.score !== null && sc.score !== undefined;
          const max = Number(a.maxScore) || 0;
          if (a.dueDate && a.dueDate < today) {
            if (has) {
              sumScore += Number(sc.score);
              sumMax += max;
            } else {
              missingList.push({ subject: subj.name, title: a.title });
            }
          }
          if (isExamType(a.type) && has && Number(sc.score) < max / 2 && (sc.retakeScore === null || sc.retakeScore === undefined)) {
            retakeList.push({ subject: subj.name, title: `${a.title} (${sc.score}/${max})` });
          }
        });
        if (sumMax > 0) {
          const pct = (sumScore / sumMax) * 100;
          if (pct < th.score) scoreLow.push({ subject: subj.name, pct: round1(pct) });
        }

        const total = data.logs.filter((l) => l.subjectId === subj.id).length;
        if (total > 0) {
          const recs = data.attendance.filter((r) => r.subjectId === subj.id && r.studentCode === st.id);
          const leave = recs.filter((r) => r.status === "leave").length;
          const absent = recs.filter((r) => r.status === "absent").length;
          const eff = Math.max(total - leave, 0);
          const present = Math.max(eff - absent, 0);
          const pct = eff > 0 ? (present / eff) * 100 : 100;
          if (pct < th.att) attLow.push({ subject: subj.name, pct: round1(pct) });
        }
      });

      const flags = [];
      if (missingList.length >= th.missing) flags.push("ค้างส่งงาน");
      if (retakeList.length > 0) flags.push("ติดซ่อมค้าง");
      if (attLow.length > 0) flags.push("เข้าเรียนต่ำ");
      if (scoreLow.length > 0) flags.push("คะแนนต่ำ");
      return { st, missingList, retakeList, attLow, scoreLow, flags };
    });
  }

  const flaggedCount = rows.filter((r) => r.flags.length > 0).length;
  const visible = (onlyFlagged ? rows.filter((r) => r.flags.length > 0) : rows).sort(
    (a, b) => b.flags.length - a.flags.length || (a.st.no || 0) - (b.st.no || 0)
  );
  const nameOf = (s) => `${s.prefix || ""}${s.firstName || ""} ${s.lastName || ""}`.trim();

  const exportXlsx = () => {
    const out = visible.map((r) => ({
      เลขที่: r.st.no,
      รหัสประจำตัว: r.st.id,
      "ชื่อ-นามสกุล": nameOf(r.st),
      สัญญาณเสี่ยง: r.flags.join(", "),
      ค้างส่งงาน: groupBySubject(r.missingList, (x) => x.title).join(" | "),
      ติดซ่อมค้าง: groupBySubject(r.retakeList, (x) => x.title).join(" | "),
      เข้าเรียนต่ำ: r.attLow.map((x) => `${x.subject} ${x.pct}%`).join(" | "),
      คะแนนต่ำ: r.scoreLow.map((x) => `${x.subject} ${x.pct}%`).join(" | "),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(out.length ? out : [{ ข้อความ: "ไม่มีนักเรียนที่เข้าเกณฑ์" }]),
      "นักเรียนที่ควรติดตาม"
    );
    XLSX.writeFile(wb, `นักเรียนที่ควรติดตาม_${roomName || "ห้อง"}_${today}.xlsx`);
  };

  const numInput = { ...inputStyle, width: 64, padding: 6, margin: "0 4px" };

  return (
    <div>
      <Link to="/teacher" style={{ color: theme.accent, fontSize: 14 }}>&larr; กลับหน้าหลัก</Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>นักเรียนที่ควรติดตาม{roomName ? `: ${roomName}` : ""}</h2>
      <p style={{ margin: "0 0 16px", color: theme.muted, fontSize: 13 }}>
        สรุปจากข้อมูลที่มีในระบบ ณ วันนี้ ({today})
      </p>
      {error && <p style={{ color: theme.danger }}>{error}</p>}

      {data && (
        <>
          <div style={{ ...cardStyle, marginBottom: 16, fontSize: 14, display: "grid", gap: 10 }}>
            <div>
              ค้างส่งงานตั้งแต่<input type="number" min="1" value={missingMin} onChange={(e) => setMissingMin(e.target.value)} style={numInput} />ใบ
              · เข้าเรียนต่ำกว่า<input type="number" min="0" max="100" value={attMin} onChange={(e) => setAttMin(e.target.value)} style={numInput} />%
              · คะแนนต่ำกว่า<input type="number" min="0" max="100" value={scoreMin} onChange={(e) => setScoreMin(e.target.value)} style={numInput} />%
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <label>
                วิชา{" "}
                <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} style={{ ...inputStyle, marginLeft: 6 }}>
                  <option value="all">ทุกวิชา</option>
                  {data.subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> แสดงเฉพาะคนที่มีสัญญาณเสี่ยง
              </label>
              <button type="button" style={btnSecondary} onClick={exportXlsx}>ส่งออก Excel</button>
            </div>
          </div>

          <p style={{ fontSize: 15 }}>
            <b>{flaggedCount}</b> จาก {rows.length} คน มีสัญญาณเสี่ยง
          </p>

          {visible.length === 0 && (
            <p style={{ color: theme.success }}>ไม่มีนักเรียนที่เข้าเกณฑ์ตอนนี้</p>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {visible.map((r) => (
              <div key={r.st.id} style={{ ...cardStyle, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>
                    {r.st.no}. {nameOf(r.st)}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {r.flags.map((f) => (
                      <span
                        key={f}
                        style={{
                          padding: "2px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                          background: FLAG_STYLE[f].bg,
                          color: FLAG_STYLE[f].color,
                        }}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
                {r.flags.length > 0 && (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: theme.muted, display: "grid", gap: 2 }}>
                    {r.flags.includes("ค้างส่งงาน") &&
                      groupBySubject(r.missingList, (x) => x.title).map((t) => <li key={`m-${t}`}>ค้างส่ง {t}</li>)}
                    {r.flags.includes("ติดซ่อมค้าง") &&
                      groupBySubject(r.retakeList, (x) => x.title).map((t) => <li key={`r-${t}`}>ติดซ่อม {t}</li>)}
                    {r.attLow.map((x) => (
                      <li key={`a-${x.subject}`}>เข้าเรียน {x.subject} {x.pct}%</li>
                    ))}
                    {r.scoreLow.map((x) => (
                      <li key={`s-${x.subject}`}>คะแนนรวม {x.subject} {x.pct}% (ของงานที่ตรวจแล้ว)</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <details style={{ ...cardStyle, marginTop: 16, fontSize: 13 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>วิธีคำนวณและข้อควรระวัง</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 4 }}>
              <li>ระบบแยกไม่ได้ว่า "ไม่ส่งงาน" หรือ "ส่งแล้วแต่ยังไม่ได้บันทึกคะแนน" ถ้าใบงานเลยกำหนดแล้วยังไม่มีคะแนน จะนับเป็นค้างส่ง ควรกรอกคะแนนให้ครบก่อนดูหน้านี้</li>
              <li>ติดซ่อมค้าง นับเฉพาะใบงานสอบที่คะแนนต่ำกว่าครึ่งและยังไม่มีคะแนนซ่อม</li>
              <li>เข้าเรียนใช้สูตรเดียวกับหน้านักเรียน ไม่นับวันลา และคำนวณเมื่อมีการเช็คคาบเรียนอย่างน้อย 1 คาบ</li>
              <li>คะแนนต่ำ คิดจากงานที่เลยกำหนดและตรวจแล้วเท่านั้น (ไม่รวมงานที่ยังไม่มีคะแนน)</li>
              <li>ใช้เป็นสัญญาณให้ไปดูรายละเอียด ไม่ใช่ข้อสรุปเกี่ยวกับตัวนักเรียน ตัวเลขข้างต้นอยู่ในเบราว์เซอร์ ไม่ได้บันทึกลงระบบ</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}