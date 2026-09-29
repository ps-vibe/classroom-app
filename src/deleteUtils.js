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

async function deleteAllDocs(docs) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
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

// ลบใบงาน 1 ชิ้น พร้อมคะแนนของนักเรียนทุกคนในใบงานนั้น
export async function deleteAssignmentCascade(classroomId, subjectId, assignmentId) {
  await deleteWhere(collection(db, "classrooms", classroomId, "scores"), "assignmentId", assignmentId);
  await deleteDoc(
    doc(db, "classrooms", classroomId, "subjects", subjectId, "assignments", assignmentId)
  );
}

// ลบวิชา 1 วิชา พร้อมใบงานทั้งหมด คะแนน และการเช็คคาบเรียนของวิชานั้น
export async function deleteSubjectCascade(classroomId, subjectId) {
  await deleteWhole(collection(db, "classrooms", classroomId, "subjects", subjectId, "assignments"));
  await deleteWhere(collection(db, "classrooms", classroomId, "scores"), "subjectId", subjectId);
  await deleteWhere(collection(db, "classrooms", classroomId, "attendance"), "subjectId", subjectId);
  await deleteDoc(doc(db, "classrooms", classroomId, "subjects", subjectId));
}

// ลบนักเรียน 1 คน พร้อมคะแนนและการเช็คคาบเรียนของคนนั้น
export async function deleteStudentCascade(classroomId, studentCode) {
  await deleteWhere(collection(db, "classrooms", classroomId, "scores"), "studentCode", studentCode);
  await deleteWhere(collection(db, "classrooms", classroomId, "attendance"), "studentCode", studentCode);
  await deleteDoc(doc(db, "classrooms", classroomId, "students", studentCode));
}

// ลบห้องเรียนทั้งห้อง พร้อมทุกอย่างข้างใน
export async function deleteClassroomCascade(classroomId) {
  const subjSnap = await getDocs(collection(db, "classrooms", classroomId, "subjects"));
  for (const subjDoc of subjSnap.docs) {
    await deleteWhole(collection(db, "classrooms", classroomId, "subjects", subjDoc.id, "assignments"));
  }
  await deleteWhole(collection(db, "classrooms", classroomId, "subjects"));
  await deleteWhole(collection(db, "classrooms", classroomId, "students"));
  await deleteWhole(collection(db, "classrooms", classroomId, "scores"));
  await deleteWhole(collection(db, "classrooms", classroomId, "attendance"));
  await deleteDoc(doc(db, "classroomSecrets", classroomId));
  await deleteDoc(doc(db, "classrooms", classroomId));
}