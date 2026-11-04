import { accessToken, getDoc, updateDoc, verifyStudent } from "./_lib/fs.js";

const reply = (res, status, body) => res.status(status).json(body);
const NUM = /^-?\d+(\.\d{1,2})?$/;

const norm = (s) =>
  String(s ?? "")
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[−–]/g, "-")
    .replace(/[$\s]/g, "");
const same = (a, b) => Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
const round2 = (n) => Math.round(n * 100) / 100;

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { message: "method not allowed" });
  const me = await verifyStudent(req);
  if (!me) return reply(res, 401, { message: "กรุณาเข้าสู่ระบบใหม่" });
  const examId = String(req.body?.examId ?? "");
  const raw = req.body?.answers;
  if (!/^[\w-]{3,60}$/.test(examId) || !raw || typeof raw !== "object") {
    return reply(res, 400, { message: "ข้อมูลไม่ถูกต้อง" });
  }
  const answers = {};
  for (const [k, v] of Object.entries(raw)) {
    if (/^\d{1,3}$/.test(k)) answers[k] = String(v ?? "").slice(0, 20);
  }

  try {
    const token = await accessToken();
    const base = `classrooms/${me.classroomId}`;
    const attemptPath = `${base}/retakeAttempts/${examId}_${me.studentCode}`;
    const att = await getDoc(token, attemptPath);
    if (!att || att.studentCode !== me.studentCode) return reply(res, 403, { message: "ไม่มีสิทธิ์" });
    if (att.status === "submitted") return reply(res, 409, { message: "ส่งข้อสอบไปแล้ว" });
    if (att.status !== "started") return reply(res, 409, { message: "ยังไม่ได้เริ่มสอบ" });
    if (Date.now() > Date.parse(att.deadlineAt) + 60000) {
      return reply(res, 410, { message: "หมดเวลาแล้ว กรุณาแจ้งครู" });
    }

    const paper = await getDoc(token, `${base}/retakePapers/${examId}`);
    const set = paper?.sets?.[att.setLabel];
    if (!set) return reply(res, 500, { message: "ไม่พบชุดข้อสอบ" });

    let earned = 0, totalScore = 0, correct = 0;
    for (const it of set.items) {
      const pts = Number(it.score) || 0;
      totalScore += pts;
      const given = answers[String(it.no)];
      let ok = false;
      if (given !== undefined) {
        if (it.type === "mcq") {
          const key = (it.choices || []).find((c) => c.isCorrect)?.label;
          ok = !!key && given === key;
        } else if (it.type === "fill") {
          const g = norm(given), k = norm(it.answer);
          ok = NUM.test(g) && NUM.test(k) && same(g, k);
        }
      }
      if (ok) { earned += pts; correct++; }
    }

    // ปรับเป็นสัดส่วนของคะแนนเต็มใบงาน
    const retakeScore = totalScore > 0 ? round2((earned / totalScore) * Number(att.maxScore)) : 0;

    const scoreSaved = await updateDoc(
      token,
      `${base}/scores/${att.assignmentId}_${me.studentCode}`,
      { retakeScore, retakeOnline: true },
      { mustExist: true }
    );
    await updateDoc(token, attemptPath, {
      status: "submitted",
      submittedAt: new Date().toISOString(),
      answers,
      earned,
      totalScore,
      correct,
      retakeScore,
      scoreSaved,
    });
    return reply(res, 200, { earned, totalScore, correct, count: set.items.length });
  } catch (err) {
    console.error("retakeSubmit error", err);
    return reply(res, 500, { message: "ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง" });
  }
}