export const theme = {
  bg: "#F4F6F8",
  card: "#FFFFFF",
  text: "#1F2937",
  muted: "#6B7280",
  border: "#E5E7EB",
  primary: "#1E3A5F",
  primaryText: "#FFFFFF",
  primaryHover: "#16304D",
  danger: "#B91C1C",
  dangerBg: "#FEF2F2",
  accent: "#4B5563",
  teal: "#0D9488",
  tealHover: "#0F766E",
  success: "#166534",
  successBg: "#F0FDF4",
  radius: 14,
};

export const cardStyle = {
  background: theme.card,
  borderRadius: theme.radius,
  border: `1px solid ${theme.border}`,
  padding: "20px",
  boxShadow: "none",
};

export const pageStyle = {
  background: theme.bg,
  minHeight: "100vh",
  fontFamily: "sans-serif",
  color: theme.text,
};

export const btnPrimary = {
  background: theme.primary,
  color: theme.primaryText,
  border: "none",
  borderRadius: 10,
  padding: "10px 18px",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

export const btnSecondary = {
  background: "#fff",
  color: theme.text,
  border: `1px solid ${theme.border}`,
  borderRadius: 10,
  padding: "10px 18px",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

export const btnDanger = {
  background: theme.dangerBg,
  color: theme.danger,
  border: `1px solid #FCA5A5`,
  borderRadius: 10,
  padding: "8px 14px",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

export const btnTeal = {
  background: theme.teal,
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 16px",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

export const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: `1px solid ${theme.border}`,
  fontSize: 14,
  outline: "none",
};