export const ASSIGNMENT_TYPES = [
  { value: "book", label: "หนังสือ", hasFlags: true },
  { value: "worksheet", label: "ใบงานเพิ่ม", hasFlags: true },
  { value: "project", label: "โปรเจค", isRubric: true },
  { value: "quiz", label: "สอบย่อย", isExam: true },
  { value: "midterm", label: "สอบกลางภาค", isExam: true },
  { value: "final", label: "สอบปลายภาค", isExam: true },
  { value: "other", label: "อื่น ๆ" },
];

export const typeLabel = (value) =>
  ASSIGNMENT_TYPES.find((t) => t.value === value)?.label ?? value;