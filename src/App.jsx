import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import StudentProtectedRoute from "./StudentProtectedRoute";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherHome from "./pages/TeacherHome";
import Classrooms from "./pages/Classrooms";
import ClassroomDetail from "./pages/ClassroomDetail";
import SubjectDetail from "./pages/SubjectDetail";
import Students from "./pages/Students";
import ScoreEntry from "./pages/ScoreEntry";
import AttendanceEntry from "./pages/AttendanceEntry";
import StudentLogin from "./pages/StudentLogin";
import StudentHome from "./pages/StudentHome";
import Landing from "./pages/Landing";
import AttendanceQR from "./pages/AttendanceQR";
import StudentScan from "./pages/StudentScan";
import AttendanceSummary from "./pages/AttendanceSummary";

export default function App() {
  return (
    <Routes>
      <Route path="/teacher/login" element={<TeacherLogin />} />
      <Route path="/teacher"  element={<ProtectedRoute>  <TeacherHome />
          </ProtectedRoute> } >
      <Route path="classroom/:classroomId/subject/:subjectId/attendance/qr"
  element={<AttendanceQR />} />
        
        <Route index element={<Classrooms />} />
        <Route path="classroom/:classroomId" element={<ClassroomDetail />} />
        <Route path="classroom/:classroomId/students" element={<Students />} />
        <Route
          path="classroom/:classroomId/subject/:subjectId"
          element={<SubjectDetail />}
        />
        <Route
          path="classroom/:classroomId/subject/:subjectId/attendance"
          element={<AttendanceEntry />}
        />
        <Route
           path="classroom/:classroomId/subject/:subjectId/attendance/summary"
           element={<AttendanceSummary />}
        />
        <Route
          path="classroom/:classroomId/subject/:subjectId/assignment/:assignmentId/scores"
          element={<ScoreEntry />}
        />
      </Route>

<Route path="/student/scan"  element={  <StudentProtectedRoute>
      <StudentScan />    </StudentProtectedRoute>  }  />
      <Route path="/student/login" element={<StudentLogin />} />
      <Route path="/student" element={<StudentProtectedRoute>
            <StudentHome />    </StudentProtectedRoute>       }     />

      <Route path="/" element={<Landing />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}