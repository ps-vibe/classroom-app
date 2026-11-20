import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnPrimary, btnSecondary, btnDanger, inputStyle } from "../theme";

export default function ExamItems() {
  const { classroomId, subjectId, assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [items, setItems] = useState([]);
  const [count, setCount] = useState("");
  const [each, setEach] = useState("1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const base = ["classrooms", classroomId, "subjects", subjectId, "assignments", assignmentId];
  const assignmentRef = doc(db, ...base);
  const configRef = doc(db, ...base, "itemAnalysis", "config");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [aSnap, cSnap] = await Promise.all([getDoc(assignmentRef), getDoc(configRef)]);
        if (cancelled) return;
        if (aSnap.exists()) setAssignment(aSnap.data());
        if (cSnap.exists()) {
          setItems(
            (cSnap.data().items || []).map((it) => ({
              no: it.no,
              maxScore: String(it.maxScore),
              topic: it.topic || "",
              bankId: it.bankId || "",
            }))
          );
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

  const total = Math.round(items.reduce((s, it) => s + (Number(it.maxScore) || 0), 0) * 100) / 100;
  const topics = [...new Set(items.map((it) => it.topic.trim()).filter(Boolean))];

  const generate = () => {
    const n = Number(count);
    const sc = Number(each);
    if (!Number.isInteger(n) || n < 1 || n > 100 || !(sc > 0)) {
      setError("ใส่จำนวนข้อ (1-100) และคะแนนต่อข้อให้ถูกต้อง");
      return;
    }
    if (items.length > 0 && !window.confirm("สร้างใหม่จะแทนที่รายการข้อเดิมทั้งหมด ต้องการทำต่อหรือไม่?")) return;
    setError("");
    setItems(Array.from({ length: n }, (_, i) => ({ no: i + 1, maxScore: String(sc), topic: "", bankId: "" })));
  };

  const update = (i, field, value) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));

  const addItem = () =>
    setItems((prev) => [...prev, { no: prev.length + 1, maxScore: "1", topic: "", bankId: "" }]);

  const removeItem = (i) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i).map((it, idx) => ({ ...it, no: idx + 1 })));

  const save = async () => {
    setError("");
    setMsg("");
    if (items.length === 0) {
      setError("ยังไม่มีข้อสอบในโครงข้อ");
      return;
    }
    if (items.some((it) => !(Number(it.maxScore) > 0))) {
      setError("คะแนนเต็มของทุกข้อต้องมากกว่า 0");
      return;
    }
    setSaving(true);
    try {
      await setDoc(configRef, {
        items: items.map((it) => ({
          no: it.no,
          maxScore: Number(it.maxScore),
          topic: it.topic.trim(),
          bankId: it.bankId.trim(),
        })),
        totalMax: total,
        updatedAt: serverTimestamp(),
      });
      setMsg("บันทึกโครงข้อเรียบร้อย");
    } catch {
      setError("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const mismatch = assignment && items.length > 0 && total !== Number(assignment.maxScore);
  const cols = "44px 84px minmax(160px, 1fr) 130px 64px";

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าวิชา
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>
        โครงข้อสอบ{assignment ? `: ${assignment.title}` : ""}
      </h2>
      <p style={{ margin: "0 0 16px", color: theme.muted, fontSize: 13 }}>
        กำหนดคะแนนเต็มและเรื่อง/ตัวชี้วัดของแต่ละข้อ เพื่อใช้วิเคราะห์ผลรายข้อ
      </p>

      {loading && <p style={{ color: theme.muted }}>กำลังโหลด...</p>}

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>สร้างโครงข้ออย่างเร็ว</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input type="number" min="1" max="100" placeholder="จำนวนข้อ" value={count} onChange={(e) => setCount(e.target.value)} style={{ ...inputStyle, width: 110 }} />
          <input type="number" min="0" step="any" placeholder="คะแนน/ข้อ" value={each} onChange={(e) => setEach(e.target.value)} style={{ ...inputStyle, width: 110 }} />
          <button type="button" style={btnSecondary} onClick={generate}>สร้างรายการข้อ</button>
        </div>
        <p style={{ margin: "8px 0 0", color: theme.muted, fontSize: 12 }}>
          สร้างแล้วปรับคะแนนรายข้อที่ไม่เท่ากันได้ในตารางด้านล่าง
        </p>
      </div>

      {items.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 520 }}>
              <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, fontSize: 12, color: theme.muted, marginBottom: 6 }}>
                <div>ข้อ</div>
                <div>คะแนนเต็ม</div>
                <div>เรื่อง/ตัวชี้วัด</div>
                <div>รหัสข้อในคลัง</div>
                <div></div>
              </div>
              {items.map((it, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, marginBottom: 6, alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>{it.no}</div>
                  <input type="number" min="0" step="any" value={it.maxScore} onChange={(e) => update(i, "maxScore", e.target.value)} style={inputStyle} />
                  <input list="topic-list" placeholder="เช่น ลำดับเลขคณิต" value={it.topic} onChange={(e) => update(i, "topic", e.target.value)} style={inputStyle} />
                  <input placeholder="(ถ้ามี)" value={it.bankId} onChange={(e) => update(i, "bankId", e.target.value)} style={inputStyle} />
                  <button type="button" style={btnDanger} onClick={() => removeItem(i)}>ลบ</button>
                </div>
              ))}
              <datalist id="topic-list">
                {topics.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 14 }}>
            รวม {items.length} ข้อ | คะแนนรวม <b>{total}</b>
            {assignment && <span style={{ color: theme.muted }}> (คะแนนเต็มของใบงาน {assignment.maxScore})</span>}
          </div>
          {mismatch && (
            <p style={{ color: theme.danger, fontSize: 13, margin: "6px 0 0" }}>
              คะแนนรวมรายข้อไม่เท่ากับคะแนนเต็มของใบงาน ตรวจสอบอีกครั้งก่อนบันทึก
            </p>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button type="button" style={btnSecondary} onClick={addItem}>+ เพิ่มข้อ</button>
            <button type="button" style={btnPrimary} onClick={save} disabled={saving}>
              {saving ? "กำลังบันทึก..." : "บันทึกโครงข้อ"}
            </button>
          </div>
        </div>
      )}

      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {msg && <p style={{ color: theme.success }}>{msg}</p>}
    </div>
  );
}