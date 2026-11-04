import katex from "katex";
import "katex/dist/katex.min.css";

function render(tex, display) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false });
  } catch {
    return tex;
  }
}

export default function RetakeMath({ text }) {
  const parts = String(text ?? "").split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g);
  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) => {
        if (p.length > 4 && p.startsWith("$$") && p.endsWith("$$"))
          return <span key={i} dangerouslySetInnerHTML={{ __html: render(p.slice(2, -2), true) }} />;
        if (p.length > 2 && p.startsWith("$") && p.endsWith("$"))
          return <span key={i} dangerouslySetInnerHTML={{ __html: render(p.slice(1, -1), false) }} />;
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}