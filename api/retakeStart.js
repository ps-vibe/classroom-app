import { accessToken, getDoc, updateDoc, verifyStudent } from "./_lib/fs.js";

const reply = (res, status, body) => res.status(status).json(body);

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { message: "method not allowed" });
  const me = await verifyStudent(req);
  if (!me) return reply(res, 401, { message: "กรุณาเข้าสู่ระบบใหม่" });
  const examId = String(req.body?.examId ?? "");
  if (!/^[\w-]{3,60}$/.test(examId)) return reply(res, 400, { message: "ข้อมูลไม่ถูกต้อง" });

  try {
    const token = await accessToken();
    const base = `classrooms/${me.classroomId}`;
    const attemptPath = `${base}/retakeAttempts/${examId}_${me.studentCode}`;
    const att = await getDoc(token, attemptPath);
    if (!att || att.studentCode !== me.studentCode) {
      return reply(res, 403, { message: "คุณไม่มีสิทธิ์สอบรายการนี้" });
    }
    if (att.status === "submitted") return reply(res, 409, { message: "ส่งข้อสอบไปแล้ว" });

    const now = Date.now();
    let deadlineAt = att.deadlineAt;
    if (att.status === "assigned") {
      if (now < Date.parse(att.opensAt)) return reply(res, 403, { message: "ยังไม่ถึงเวลาสอบ" });
      if (now > Date.parse(att.closesAt)) return reply(res, 403, { message: "หมดเวลาเปิดสอบแล้ว" });
      const dl = Math.min(now + Number(att.durationMin) * 60000, Date.parse(att.closesAt));
      deadlineAt = new Date(dl).toISOString();
      await updateDoc(token, attemptPath, {
        status: "started",
        startedAt: new Date(now).toISOString(),
        deadlineAt,
      });
    } else if (now > Date.parse(deadlineAt) + 60000) {
      return reply(res, 410, { message: "หมดเวลาทำข้อสอบแล้ว กรุณาแจ้งครู" });
    }

    const paper = await getDoc(token, `${base}/retakePapers/${examId}`);
    const set = paper?.sets?.[att.setLabel];
    if (!set) return reply(res, 500, { message: "ไม่พบชุดข้อสอบ กรุณาแจ้งครู" });

    // ส่งเฉพาะโจทย์ ไม่ส่งเฉลยและไม่ส่ง isCorrect
    const items = set.items.map((it) => ({
      no: it.no,
      type: it.type,
      stem: it.stem,
      images: it.images || [],
      score: it.score,
      choices: (it.choices || []).map((c) => ({ label: c.label, text: c.text, image: c.image || null })),
    }));
    return reply(res, 200, {
      title: att.title,
      setLabel: att.setLabel,
      deadlineAt,
      serverNow: new Date().toISOString(),
      items,
    });
  } catch (err) {
    console.error("retakeStart error", err);
    return reply(res, 500, { message: "ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง" });
  }
}