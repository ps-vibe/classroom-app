import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function StudentProtectedRoute({ children }) {
  const { loading, isStudent } = useAuth();

  if (loading) return <p>กำลังโหลด...</p>;
  if (!isStudent) return <Navigate to="/student/login" replace />;

  return children;
}