import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function StudentProtectedRoute({ children }) {
  const { loading, isStudent } = useAuth();
  const location = useLocation();

  if (loading) return <p>กำลังโหลด...</p>;
  if (!isStudent) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/student/login?next=${next}`} replace />;
  }

  return children;
}