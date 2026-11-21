import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnPrimary, btnSecondary, btnDanger, inputStyle } from "../theme";
import { LEVELS, LEVEL_LABEL, DEFAULT_LATE_DAYS, lateText, PROJECT_CRITERIA, WORKSHEET_CRITERIA } from "../rubricUtils";

const colRef = collection(db, "rubricCriteria");

function Editor({ c, onSave, onCancel, busy }) {
  const [name, setName] = useState(c.name || "");
  const [levels, setLevels] = useState({ 4: "", 3: "", 2: "", 1: "", ...(c.levels || {}) });
  const [lateDays, setLateDays] = useState((c.lateDays || DEFAULT_LATE_DAYS).map(String));
  const [err, setErr] = useState("");
  const isLate = c.kind === "late";

  const submit = () => {
    if (!name.trim()) {
      setErr("กรอกชื่อเกณฑ์");
      return;
    }
    if (isLate) {
      const d = lateDays.map(Number);
      if (d.some((x) => !Number.isInteger(x) || x < 0) || !(d[0] < d[1] && d[1] < d[2])) {
        setErr("จำนวนวันต้องเป็นจำนวนเต็มและเรียงจากน้อยไปมาก เช่น 0, 2, 5");
        return;
      }
      onSave(c.id, { name: name.trim(), lateDays: d });
    } else {
      onSave(c.id, { name: name.trim(), levels });
    }
  };

  return (
    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อเกณฑ์" style={inputStyle} />
      {isLate ? (
        <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
          {[0, 1, 2].map((i) => (
            <label key={i}>
              ระดับ {4 - i} = ส่งช้าไม่เกิน{" "}
              <input
                type="number"
                min="0"
                value={lateDays[i]}
                onChange={(e) => setLateDays((p) => p.map((v, idx) => (idx === i ? e.target.value : v)))}
                style={{ ...inputStyle, width: 70, padding: 6 }}
              />{" "}
              วัน {i === 0 && <span style={{ color: theme.muted }}>(0 = ตรงกำหนด)</span>}
            </label>
          ))}
          <div style={{ color: theme.muted }}>ระดับ 1 = ช้ากว่านั้น</div>
        </div>
      ) : (
        LEVELS.map((l) => (
          <label key={l} style={{ fontSize: 13 }}>
            ระดับ {l} {LEVEL_LABEL[l]}
            <textarea
              rows={2}
              value={levels[l]}
              onChange={(e) => setLevels((p) => ({ ...p, [l]: e.target.value }))}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginTop: 4, fontFamily: "inherit" }}
            />
          </label>
        ))
      )}
      {err && <div style={{ color: theme.danger, fontSize: 13 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={btnPrimary} onClick={submit} disabled={busy}>บันทึก</button>
        <button type="button" style={btnSecondary} onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

export default function RubricLibrary() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = async () => {
    try {
      const snap = await getDocs(colRef);
      setList(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    } catch {
      setError("โหลดคลังเกณฑ์ไม่สำเร็จ (ถ้าขึ้นว่าไม่มีสิทธิ์ ต้องเพิ่ม Firestore rules ของ rubricCriteria)");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const seed = async () => {
    setBusy(true);
    setError("");
    try {
      const batch = writeBatch(db);
      PROJECT_CRITERIA.forEach((c, i) => {
        batch.set(doc(colRef), { ...c, order: i + 1, createdAt: serverTimestamp() });
      });
      await batch.commit();
      setMsg("สร้างเกณฑ์เริ่มต้นเรียบร้อย");
      await load();
    } catch {
      setError("สร้างเกณฑ์เริ่มต้นไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const addWorksheetSet = async () => {
    setBusy(true);
    setError("");
    try {
      const have = new Set(list.map((c) => c.name));
      const toAdd = WORKSHEET_CRITERIA.filter((c) => !have.has(c.name));
      if (toAdd.length === 0) {
        setMsg("มีชุดตัวชี้วัดหนังสือ/ใบงานครบอยู่แล้ว");
        return;
      }
      const start = list.reduce((m, c) => Math.max(m, c.order ?? 0), 0);
      const batch = writeBatch(db);
      toAdd.forEach((c, i) => {
        batch.set(doc(colRef), { ...c, order: start + i + 1, createdAt: serverTimestamp() });
      });
      await batch.commit();
      setMsg(`เพิ่มตัวชี้วัดหนังสือ/ใบงาน ${toAdd.length} ข้อเรียบร้อย`);
      await load();
    } catch {
      setError("เพิ่มชุดตัวชี้วัดไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const addNew = async () => {
    setBusy(true);
    setError("");
    try {
      const order = list.reduce((m, c) => Math.max(m, c.order ?? 0), 0) + 1;
      const ref = await addDoc(colRef, {
        name: "เกณฑ์ใหม่",
        kind: "level",
        levels: { 4: "", 3: "", 2: "", 1: "" },
        order,
        createdAt: serverTimestamp(),
      });
      await load();
      setEditingId(ref.id);
    } catch {
      setError("เพิ่มเกณฑ์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const save = async (id, data) => {
    setBusy(true);
    setError("");
    try {
      await updateDoc(doc(db, "rubricCriteria", id), { ...data, updatedAt: serverTimestamp() });
      setEditingId(null);
      setMsg("บันทึกเรียบร้อย");
      await load();
    } catch {
      setError("บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`ลบเกณฑ์ "${c.name}" ออกจากคลังใช่หรือไม่? (โปรเจกต์ที่ใช้เกณฑ์นี้ไปแล้วจะไม่ได้รับผลกระทบ)`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "rubricCriteria", c.id));
      await load();
    } catch {
      setError("ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Link to="/teacher" style={{ color: theme.accent, fontSize: 14 }}>&larr; กลับหน้าหลัก</Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>คลังเกณฑ์การให้คะแนน</h2>
      <p style={{ margin: "0 0 16px", color: theme.muted, fontSize: 13 }}>
        เกณฑ์ละ 4 ระดับ ใช้ซ้ำได้ทุกโปรเจกต์ ระดับ 4 ดีมาก · 3 ดี · 2 พอใช้ · 1 ปรับปรุง
      </p>

      {loading && <p style={{ color: theme.muted }}>กำลังโหลด...</p>}
      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {msg && <p style={{ color: theme.success }}>{msg}</p>}

      {!loading && list.length === 0 && !error && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <p style={{ marginTop: 0 }}>ยังไม่มีเกณฑ์ในคลัง</p>
          <button type="button" style={btnPrimary} onClick={seed} disabled={busy}>
            สร้างเกณฑ์เริ่มต้น 7 ข้อ
          </button>
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {list.map((c) => (
          <div key={c.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {c.name}
                {c.kind === "late" && (
                  <span style={{ color: theme.muted, fontWeight: 400, fontSize: 13 }}> [คำนวณจากวันส่ง]</span>
                )}
              </div>
              {editingId !== c.id && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={btnSecondary} onClick={() => setEditingId(c.id)}>แก้ไข</button>
                  <button type="button" style={btnDanger} onClick={() => remove(c)} disabled={busy}>ลบ</button>
                </div>
              )}
            </div>
            {editingId === c.id ? (
              <Editor c={c} onSave={save} onCancel={() => setEditingId(null)} busy={busy} />
            ) : (
              <div style={{ marginTop: 8, fontSize: 13, display: "grid", gap: 4 }}>
                {LEVELS.map((l) => (
                  <div key={l}>
                    <b>{l} {LEVEL_LABEL[l]}:</b>{" "}
                    {c.kind === "late" ? lateText(c.lateDays || DEFAULT_LATE_DAYS, l) : c.levels?.[l] || <span style={{ color: theme.muted }}>(ยังไม่มีคำอธิบาย)</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {list.length > 0 && (
        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={btnSecondary} onClick={addNew} disabled={busy}>+ เพิ่มเกณฑ์ใหม่</button>
          <button type="button" style={btnSecondary} onClick={addWorksheetSet} disabled={busy}>
            + เพิ่มชุดตัวชี้วัดหนังสือ/ใบงาน
          </button>
        </div>
      )}
    </div>
  );
}