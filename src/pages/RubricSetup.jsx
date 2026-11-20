import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnPrimary, btnSecondary, inputStyle } from "../theme";
import { DEFAULT_LATE_DAYS } from "../rubricUtils";

const round2 = (n) => Math.round(n * 100) / 100;

export default function RubricSetup() {
  const { classroomId, subjectId, assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [options, setOptions] = useState([]);
  const [weights, setWeights] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const base = ["classrooms", classroomId, "subjects", subjectId, "assignments", assignmentId];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [aSnap, libSnap, cfgSnap] = await Promise.all([
          getDoc(doc(db, ...base)),
          getDocs(collection(db, "rubricCriteria")),
          getDoc(doc(db, ...base, "rubric", "config")),
        ]);
        if (cancelled) return;
        if (aSnap.exists()) setAssignment(aSnap.data());
        const lib = libSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const saved = cfgSnap.exists() ? cfgSnap.data().criteria || [] : [];
        const opts = [...lib];
        saved.forEach((e) => {
          if (!lib.find((l) => l.id === e.criterionId)) {
            opts.push({ id: e.criterionId, name: e.name, kind: e.kind, levels: e.levels, lateDays: e.lateDays, orphan: true });
          }
        });
        setOptions(opts);
        const w = {};
        saved.forEach((e) => {
          w[e.criterionId] = String(e.weight);
        });
        setWeights(w);
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

  const selected = options.filter((o) => o.id in weights);
  const total = round2(selected.reduce((s, o) => s + (Number(weights[o.id]) || 0), 0));
  const maxScore = Number(assignment?.maxScore) || 0;

  const toggle = (id) => {
    setMsg("");
    setWeights((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = "";
      return next;
    });
  };

  const equalize = () => {
    const n = selected.length;
    if (n === 0) return;
    const baseW = Math.floor(100 / n);
    const rest = 100 - baseW * n;
    const next = { ...weights };
    selected.forEach((o, i) => {
      next[o.id] = String(baseW + (i < rest ? 1 : 0));
    });
    setWeights(next);
    setMsg("");
  };

  const save = async () => {
    setError("");
    setMsg("");
    if (selected.length === 0) {
      setError("เลือกเกณฑ์อย่างน้อย 1 ข้อ");
      return;
    }
    if (selected.some((o) => !(Number(weights[o.id]) > 0))) {
      setError("น้ำหนักของทุกเกณฑ์ที่เลือกต้องมากกว่า 0");
      return;
    }
    if (total !== 100) {
      setError(`น้ำหนักรวมต้องเท่ากับ 100% (ตอนนี้ ${total}%)`);
      return;
    }
    setSaving(true);
    try {
      const criteria = selected.map((o) => {
        const entry = { criterionId: o.id, name: o.name, kind: o.kind, weight: Number(weights[o.id]) };
        if (o.kind === "late") entry.lateDays = o.lateDays || DEFAULT_LATE_DAYS;
        else entry.levels = o.levels || {};
        return entry;
      });
      await setDoc(doc(db, ...base, "rubric", "config"), { criteria, updatedAt: serverTimestamp() });
      setMsg("บันทึกเกณฑ์ของโปรเจกต์เรียบร้อย");
    } catch {
      setError("บันทึกไม่สำเร็จ (ถ้าขึ้นว่าไม่มีสิทธิ์ ให้ตรวจ Firestore rules ของ rubric)");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าวิชา
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>
        เกณฑ์การประเมิน{assignment ? `: ${assignment.title}` : ""}
      </h2>
      <p style={{ margin: "0 0 16px", color: theme.muted, fontSize: 13 }}>
        เลือกเกณฑ์จากคลังและกำหนดน้ำหนัก (รวม 100%) คะแนนเต็มของงานนี้ {maxScore || "-"} คะแนน
      </p>

      {loading && <p style={{ color: theme.muted }}>กำลังโหลด...</p>}

      {!loading && options.length === 0 && (
        <p>
          ยังไม่มีเกณฑ์ในคลัง <Link to="/teacher/rubric-criteria">ไปสร้างที่คลังเกณฑ์</Link>
        </p>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {options.map((o) => {
          const on = o.id in weights;
          const w = Number(weights[o.id]) || 0;
          return (
            <div key={o.id} style={{ ...cardStyle, padding: 14, borderColor: on ? theme.teal : theme.border }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 200, cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(o.id)} />
                  <span style={{ fontWeight: 700, fontSize: 15 }}>
                    {o.name}
                    {o.kind === "late" && <span style={{ color: theme.muted, fontWeight: 400, fontSize: 13 }}> [คำนวณจากวันส่ง]</span>}
                    {o.orphan && <span style={{ color: theme.danger, fontWeight: 400, fontSize: 13 }}> (ถูกลบจากคลังแล้ว)</span>}
                  </span>
                </label>
                {on && (
                  <div style={{ fontSize: 14 }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      value={weights[o.id]}
                      onChange={(e) => {
                        setMsg("");
                        setWeights((p) => ({ ...p, [o.id]: e.target.value }));
                      }}
                      style={{ ...inputStyle, width: 70, padding: 6 }}
                    />{" "}
                    %{" "}
                    <span style={{ color: theme.muted }}>= {round2((maxScore * w) / 100)} คะแนน</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {options.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ margin: "0 0 10px", fontSize: 14, color: total === 100 ? theme.success : theme.danger }}>
            น้ำหนักรวม {total}% {total === 100 ? "(ครบ)" : "(ต้องเท่ากับ 100)"}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={btnSecondary} onClick={equalize} disabled={selected.length === 0}>
              แบ่งน้ำหนักเท่า ๆ กัน
            </button>
            <button type="button" style={btnPrimary} onClick={save} disabled={saving}>
              {saving ? "กำลังบันทึก..." : "บันทึกเกณฑ์ของโปรเจกต์"}
            </button>
          </div>
        </div>
      )}

      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {msg && <p style={{ color: theme.success }}>{msg}</p>}
    </div>
  );
}