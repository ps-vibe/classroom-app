import {
  collection,
  doc,
  deleteDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";

// คอลเลกชันที่อยู่ใต้ใบงาน (ต้องลบก่อนลบใบงาน เพราะ Firestore ไม่ลบเอกสารลูกให้)
const ASSIGNMENT_SUBCOLLECTIONS = ["itemAnalysis", "itemScores", "rubric"];

async function deleteRefs(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

async function deleteAllDocs(docs) {
  await deleteRefs(docs.map((d) => d.ref));
}

async function deleteWhole(colRef) {
  const snap = await getDocs(colRef);
  await deleteAllDocs(snap.docs);
}

async function deleteWhere(colRef, field, value) {
  const snap = await getDocs(query(colRef, where(field, "==", value)));
  console.log(`deleteWhere: ${field} == ${value} -> พบ ${snap.docs.length} เอกสาร`);
  await deleteAllDocs(snap.docs);
}

// ลบเอกสารที่ฟิลด์ขึ้นต้นด้วยข้อความที่กำหนด (ใช้กับ sessionId ของรายการสแกน QR)
async function deleteWherePrefix(colRef, field, prefix) {
  const snap = await getDocs(
    query(colRef, where(field, ">=", prefix), where(field, "<=", prefix + "\uf8ff"))
  );
  console.log(`deleteWherePrefix: ${field} ขึ้นต้นด้วย ${prefix} -> พบ ${snap.docs.length} เอกสาร`);
  await deleteAllDocs(snap.docs);
}

// รวบรวมรหัสรูปทั้งหมดที่ชุดข้อสอบซ่อมใช้
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

// ลบข้อมูลสอบซ่อมของใบงานที่ระบุ: รูปที่ไม่มีใบงานอื่นใช้ร่วม -> การแจกข้อสอบ -> ตั้งค่าการสอบ -> ชุดข้อสอบ
// (ลบชุดข้อสอบเป็นอย่างสุดท้าย เพื่อให้กดลบซ้ำได้ถ้าเกิดข้อผิดพลาดกลางทาง)
async function deleteRetakeData(classroomId, assignmentIds) {
  if (assignmentIds.length === 0) return;
  const base = ["classrooms", classroomId];
  const target = new Set(assignmentIds);

  const papersSnap = await getDocs(collection(db, ...base, "retakePapers"));
  const mine = new Set();
  const others = new Set();
  papersSnap.docs.forEach((d) => {
    const ids = collectImageIds(d.data().sets);
    ids.forEach((id) => (target.has(d.id) ? mine : others).add(id));
  });
  const orphanImages = [...mine].filter((id) => !others.has(id));
  console.log(`deleteRetakeData: รูปที่จะลบ ${orphanImages.length} รูป (ใช้ร่วมกับใบงานอื่น ${mine.size - orphanImages.length} รูป)`);

  await deleteRefs(orphanImages.map((id) => doc(db, ...base, "retakeImages", id)));
  for (const id of assignmentIds) {
    await deleteWhere(collection(db, ...base, "retakeAttempts"), "assignmentId", id);
  }
  await deleteRefs(assignmentIds.map((id) => doc(db, ...base, "retakeExams", id)));
  await deleteRefs(assignmentIds.map((id) => doc(db, ...base, "retakePapers", id)));
}

// ลบเอกสารลูกทั้งหมดใต้ใบงาน 1 ใบ (โครงข้อ คะแนนรายข้อ เกณฑ์ประเมิน/กลุ่ม)
async function deleteAssignmentChildren(classroomId, subjectId, assignmentId) {
  const base = ["classrooms", classroomId, "subjects", subjectId, "assignments", assignmentId];
  for (const name of ASSIGNMENT_SUBCOLLECTIONS) {
    await deleteWhole(collection(db, ...base, name));
  }
}

// ลบใบงาน 1 ชิ้น พร้อมคะแนน สถานะการส่งงาน ข้อมูลสอบซ่อม และข้อมูลลูกทั้งหมดใต้ใบงานนั้น
export async function deleteAssignmentCascade(classroomId, subjectId, assignmentId) {
  await deleteRetakeData(classroomId, [assignmentId]);
  await deleteAssignmentChildren(classroomId, subjectId, assignmentId);
  await deleteWhere(collection(db, "classrooms", classroomId, "scores"), "assignmentId", assignmentId);
  await deleteWhere(collection(db, "classrooms", classroomId, "submissions"), "assignmentId", assignmentId);
  await deleteDoc(
    doc(db, "classrooms", classroomId, "subjects", subjectId, "assignments", assignmentId)
  );
}

// ลบวิชา 1 วิชา พร้อมใบงานทั้งหมด (รวมข้อมูลลูกและสอบซ่อม) คะแนน และการเช็คคาบเรียนทุกชนิดของวิชานั้น
export async function deleteSubjectCascade(classroomId, subjectId) {
  const aSnap = await getDocs(
    collection(db, "classrooms", classroomId, "subjects", subjectId, "assignments")
  );
  await deleteRetakeData(classroomId, aSnap.docs.map((a) => a.id));
  for (const a of aSnap.docs) {
    await deleteAssignmentChildren(classroomId, subjectId, a.id);
  }
  await deleteAllDocs(aSnap.docs);
  await deleteWhere(collection(db, "classrooms", classroomId, "scores"), "subjectId", subjectId);
  await deleteWhere(collection(db, "classrooms", classroomId, "submissions"), "subjectId", subjectId);
  await deleteWhere(collection(db, "classrooms", classroomId, "attendance"), "subjectId", subjectId);
  await deleteWhere(collection(db, "classrooms", classroomId, "attendanceLog"), "subjectId", subjectId);
  await deleteWhere(collection(db, "classrooms", classroomId, "attendanceSessions"), "subjectId", subjectId);
  await deleteWherePrefix(collection(db, "classrooms", classroomId, "attendanceScans"), "sessionId", `${subjectId}_`);
  await deleteDoc(doc(db, "classrooms", classroomId, "subjects", subjectId));
}

// ลบนักเรียน 1 คน พร้อมคะแนน สถานะการส่งงาน คะแนนรายข้อ การเช็คคาบเรียน รายการสแกน QR และผลสอบซ่อมของคนนั้น
export async function deleteStudentCascade(classroomId, studentCode) {
  await deleteWhere(collection(db, "classrooms", classroomId, "scores"), "studentCode", studentCode);
  await deleteWhere(collection(db, "classrooms", classroomId, "submissions"), "studentCode", studentCode);
  await deleteWhere(collection(db, "classrooms", classroomId, "gcStudents"), "studentCode", studentCode);
  await deleteWhere(collection(db, "classrooms", classroomId, "attendance"), "studentCode", studentCode);
  await deleteWhere(collection(db, "classrooms", classroomId, "attendanceScans"), "studentCode", studentCode);
  await deleteWhere(collection(db, "classrooms", classroomId, "retakeAttempts"), "studentCode", studentCode);

  // คะแนนรายข้อของนักเรียนคนนี้ใต้ทุกใบงานของทุกวิชา (ถ้าไม่มีเอกสาร การลบจะข้ามไปเอง)
  const subjSnap = await getDocs(collection(db, "classrooms", classroomId, "subjects"));
  for (const subj of subjSnap.docs) {
    const aSnap = await getDocs(
      collection(db, "classrooms", classroomId, "subjects", subj.id, "assignments")
    );
    const refs = aSnap.docs.map((a) =>
      doc(db, "classrooms", classroomId, "subjects", subj.id, "assignments", a.id, "itemScores", studentCode)
    );
    await deleteRefs(refs);
  }

  await deleteDoc(doc(db, "classrooms", classroomId, "students", studentCode));
}

// ลบห้องเรียนทั้งห้อง การเช็คชื่อ ข้อสอบซ่อม พร้อมทุกอย่างข้างใน
export async function deleteClassroomCascade(classroomId) {
  const subjSnap = await getDocs(collection(db, "classrooms", classroomId, "subjects"));
  for (const subjDoc of subjSnap.docs) {
    const aSnap = await getDocs(
      collection(db, "classrooms", classroomId, "subjects", subjDoc.id, "assignments")
    );
    for (const a of aSnap.docs) {
      await deleteAssignmentChildren(classroomId, subjDoc.id, a.id);
    }
    await deleteAllDocs(aSnap.docs);
  }
  await deleteWhole(collection(db, "classrooms", classroomId, "subjects"));
  await deleteWhole(collection(db, "classrooms", classroomId, "students"));
  await deleteWhole(collection(db, "classrooms", classroomId, "scores"));
  await deleteWhole(collection(db, "classrooms", classroomId, "submissions"));
  await deleteWhole(collection(db, "classrooms", classroomId, "gcStudents"));
  await deleteWhole(collection(db, "classrooms", classroomId, "attendance"));
  await deleteWhole(collection(db, "classrooms", classroomId, "attendanceLog"));
  await deleteWhole(collection(db, "classrooms", classroomId, "attendanceScans"));
  await deleteWhole(collection(db, "classrooms", classroomId, "attendanceSessions"));
  await deleteWhole(collection(db, "classrooms", classroomId, "retakeExams"));
  await deleteWhole(collection(db, "classrooms", classroomId, "retakePapers"));
  await deleteWhole(collection(db, "classrooms", classroomId, "retakeAttempts"));
  await deleteWhole(collection(db, "classrooms", classroomId, "retakeImages"));
  await deleteDoc(doc(db, "classroomSecrets", classroomId));
  await deleteDoc(doc(db, "classrooms", classroomId));
}