import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { ASSIGNMENT_TYPES, typeLabel } from "../constants";
import { theme, cardStyle, btnPrimary, btnSecondary, inputStyle } from "../theme";
import { DEFAULT_LATE_DAYS, WORKSHEET_CRITERIA } from "../rubricUtils";

const round2 = (n) => Math.round(n * 100) / 100;
const WS_NAMES = new Set(WORKSHEET_CRITERIA.map((c) => c.name));

// ชุดแนะนำ: [ชื่อเกณฑ์ในคลัง, น้ำหนัก%]
const PRESETS = {
  worksheet: [
    ["ความถูกต้องของคำตอบ (ร้อยละที่ทำถูก)", 50],
    ["การแสดงวิธีทำและเหตุผล", 20],
    ["ความเป็นระเบียบเรียบร้อย", 15],
    ["การส่งตรงเวลา (หนังสือ/ใบงาน)", 15],
  ],
  project: [
    ["ความถูกต้องสมบูรณ์ตามหลักวิชา", 50],
    ["ความคิดสร้างสรรค์และเป็นระบบ", 30],
    ["การตรงต่อเวลา", 20],
  ],
};

export default function RubricSetup() {
  const { classroomId, subjectId, assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [options, setOptions] = useState([]);
  const [weights, setWeights] = useState({});
  const [sources, setSources] = useState(null);
  const [sourceKey, setSourceKey] = useState("");
  const [loadingSources, setLoadingSources] = useState(false);
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

  // แยกเกณฑ์ตามประเภทงาน
  const typeGroup = ["book", "worksheet"].includes(assignment?.type)
    ? "worksheet"
    : assignment?.type === "project"
    ? "project"
    : "all";
  const isWs = (o) => WS_NAMES.has(o.name);
  let recommended = options;
  let others = [];
  if (typeGroup === "worksheet") {
    recommended = options.filter(isWs);
    others = options.filter((o) => !isWs(o));
  } else if (typeGroup === "project") {
    recommended = options.filter((o) => !isWs(o));
    others = options.filter(isWs);
  }
  const missingWs =
    typeGroup === "worksheet" ? WORKSHEET_CRITERIA.filter((c) => !options.find((o) => o.name === c.name)) : [];
  const preset = PRESETS[typeGroup];

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

  const applyPreset = () => {
    if (!preset) return;
    const w = {};
    const missing = [];
    preset.forEach(([name, weight]) => {
      const o = options.find((x) => x.name === name);
      if (o) w[o.id] = String(weight);
      else missing.push(name);
    });
    if (missing.length > 0) {
      setError(`ยังไม่มีในคลังเกณฑ์: ${missing.join(", ")} (ไปเพิ่มที่หน้าคลังเกณฑ์ก่อน)`);
      return;
    }
    if (Object.keys(weights).length > 0 && !window.confirm("ชุดแนะนำจะแทนที่เกณฑ์และน้ำหนักที่เลือกไว้ตอนนี้ ต้องการทำต่อหรือไม่?")) return;
    setWeights(w);
    setError("");
    setMsg('ใส่ชุดแนะนำแล้ว ปรับน้ำหนักได้ แล้วกด "บันทึกเกณฑ์" (ยังไม่ได้บันทึก)');
  };

  // ---------- คัดลอกเกณฑ์จากใบงานอื่นในห้องเดียวกัน ----------
  const loadSources = async () => {
    setLoadingSources(true);
    setError("");
    try {
      const subjSnap = await getDocs(collection(db, "classrooms", classroomId, "subjects"));
      const found = [];
      for (const s of subjSnap.docs) {
        const aSnap = await getDocs(collection(db, "classrooms", classroomId, "subjects", s.id, "assignments"));
        const cand = aSnap.docs.filter(
          (d) =>
            !(s.id === subjectId && d.id === assignmentId) &&
            !ASSIGNMENT_TYPES.find((t) => t.value === d.data().type)?.isExam
        );
        const cfgs = await Promise.all(
          cand.map((d) =>
            getDoc(doc(db, "classrooms", classroomId, "subjects", s.id, "assignments", d.id, "rubric", "config"))
          )
        );
        cand.forEach((d, i) => {
          const criteria = cfgs[i].exists() ? cfgs[i].data().criteria || [] : [];
          if (criteria.length > 0) {
            found.push({
              key: `${s.id}/${d.id}`,
              label: `${s.data().name} › ${d.data().title} (${typeLabel(d.data().type)})`,
              subject: s.data().name || "",
              due: d.data().dueDate || "",
              criteria,
            });
          }
        });
      }
      found.sort((a, b) => a.subject.localeCompare(b.subject) || b.due.localeCompare(a.due));
      setSources(found);
      setSourceKey(found[0]?.key || "");
    } catch {
      setError("โหลดรายการใบงานต้นแบบไม่สำเร็จ");
    } finally {
      setLoadingSources(false);
    }
  };

  const applySource = () => {
    const src = sources?.find((x) => x.key === sourceKey);
    if (!src) return;
    if (
      Object.keys(weights).length > 0 &&
      !window.confirm("การคัดลอกจะแทนที่เกณฑ์และน้ำหนักที่เลือกไว้ตอนนี้ ต้องการทำต่อหรือไม่?")
    )
      return;
    setOptions((prev) => {
      const next = [...prev];
      src.criteria.forEach((e) => {
        if (!next.find((o) => o.id === e.criterionId)) {
          next.push({ id: e.criterionId, name: e.name, kind: e.kind, levels: e.levels, lateDays: e.lateDays, orphan: true });
        }
      });
      return next;
    });
    const w = {};
    src.criteria.forEach((e) => {
      w[e.criterionId] = String(e.weight);
    });
    setWeights(w);
    setError("");
    setMsg('คัดลอกแล้ว ตรวจน้ำหนักให้เรียบร้อย แล้วกด "บันทึกเกณฑ์" (ยังไม่ได้บันทึก)');
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
      setMsg("บันทึกเกณฑ์เรียบร้อย");
    } catch {
      setError("บันทึกไม่สำเร็จ (ถ้าขึ้นว่าไม่มีสิทธิ์ ให้ตรวจ Firestore rules ของ rubric)");
    } finally {
      setSaving(false);
    }
  };

  const currentSource = sources?.find((x) => x.key === sourceKey);

  const renderOption = (o) => {
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
        {assignment ? `ประเภท ${typeLabel(assignment.type)} · ` : ""}เลือกเกณฑ์จากคลังและกำหนดน้ำหนัก (รวม 100%) คะแนนเต็มของงานนี้ {maxScore || "-"} คะแนน
      </p>

      {loading && <p style={{ color: theme.muted }}>กำลังโหลด...</p>}

      {!loading && preset && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>ชุดแนะนำสำหรับงานประเภทนี้</h3>
          <p style={{ margin: "0 0 10px", color: theme.muted, fontSize: 13 }}>
            {preset.map(([name, w]) => `${name} ${w}%`).join(" · ")}
          </p>
          <button type="button" style={btnSecondary} onClick={applyPreset}>
            ใช้ชุดแนะนำ
          </button>
        </div>
      )}

      {!loading && missingWs.length > 0 && (
        <p style={{ color: "#B45309", fontSize: 13 }}>
          ยังไม่มีตัวชี้วัดหนังสือ/ใบงานในคลังเกณฑ์ {missingWs.length} ข้อ{" "}
          <Link to="/teacher/rubric-criteria">ไปกดเพิ่มที่หน้าคลังเกณฑ์</Link> (ปุ่ม "+ เพิ่มชุดตัวชี้วัดหนังสือ/ใบงาน")
        </p>
      )}

      {!loading && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>คัดลอกเกณฑ์จากใบงานอื่น</h3>
          <p style={{ margin: "0 0 10px", color: theme.muted, fontSize: 13 }}>
            ตั้งชุดเกณฑ์ครั้งเดียว แล้วใช้ซ้ำกับใบงานอื่นในห้องนี้ได้ (ไม่รวมใบงานประเภทสอบ)
          </p>
          {sources === null && (
            <button type="button" style={btnSecondary} onClick={loadSources} disabled={loadingSources}>
              {loadingSources ? "กำลังค้นหา..." : "เลือกจากใบงานที่ตั้งเกณฑ์ไว้แล้ว"}
            </button>
          )}
          {sources !== null && sources.length === 0 && (
            <p style={{ margin: 0, fontSize: 14, color: theme.muted }}>ยังไม่มีใบงานอื่นในห้องนี้ที่ตั้งเกณฑ์ไว้</p>
          )}
          {sources !== null && sources.length > 0 && (
            <div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)} style={{ ...inputStyle, maxWidth: "100%" }}>
                  {sources.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                <button type="button" style={btnPrimary} onClick={applySource}>คัดลอก</button>
              </div>
              {currentSource && (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: theme.muted }}>
                  {currentSource.criteria.map((e) => `${e.name} ${e.weight}%`).join(" · ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && options.length === 0 && (
        <p>
          ยังไม่มีเกณฑ์ในคลัง <Link to="/teacher/rubric-criteria">ไปสร้างที่คลังเกณฑ์</Link>
        </p>
      )}

      <div style={{ display: "grid", gap: 10 }}>{recommended.map(renderOption)}</div>

      {others.length > 0 && (
        <details open={others.some((o) => o.id in weights)} style={{ marginTop: 14 }}>
          <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 700 }}>เกณฑ์อื่นในคลัง ({others.length})</summary>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>{others.map(renderOption)}</div>
        </details>
      )}

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
              {saving ? "กำลังบันทึก..." : "บันทึกเกณฑ์"}
            </button>
          </div>
        </div>
      )}

      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {msg && <p style={{ color: theme.success }}>{msg}</p>}
    </div>
  );
}