/** The agent's instructions, rendered read only. */

import { useEffect, useState, type ReactNode } from "react";
import { agentInstructions } from "../lib/api";

/** Render emphasis as safe React text. */
function inline(text: string): ReactNode[] {
  return text
    .split("**")
    .map((part, index) =>
      index % 2 === 1 ? <strong key={index}>{part}</strong> : part,
    );
}

/** Render the headings, paragraphs and lists used by the instructions. */
function blocks(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];
  /** Finish any accumulated list. */
  const flush = () => {
    if (bullets.length > 0) {
      parts.push(
        <ul key={`bullets-${String(parts.length)}`}>
          {bullets.map((item) => (
            <li key={item}>{inline(item)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
    if (numbers.length > 0) {
      parts.push(
        <ol key={`numbers-${String(parts.length)}`}>
          {numbers.map((item) => (
            <li key={item}>{inline(item)}</li>
          ))}
        </ol>,
      );
      numbers = [];
    }
  };
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      flush();
    } else if (trimmed.startsWith("# ")) {
      flush();
      parts.push(<h3 key={parts.length}>{inline(trimmed.slice(2))}</h3>);
    } else if (trimmed.startsWith("## ")) {
      flush();
      parts.push(<h4 key={parts.length}>{inline(trimmed.slice(3))}</h4>);
    } else if (trimmed.startsWith("- ")) {
      bullets.push(trimmed.slice(2));
    } else if (/^\d+\.\s/.test(trimmed)) {
      numbers.push(trimmed.replace(/^\d+\.\s/, ""));
    } else {
      flush();
      parts.push(<p key={parts.length}>{inline(trimmed)}</p>);
    }
  }
  flush();
  return parts;
}

/** Fetch and display the backend instructions read only. */
export function InstructionsPage() {
  const [instructions, setInstructions] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    agentInstructions().then(
      (text) => {
        setInstructions(text);
        setError(null);
      },
      (cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "The instructions could not be loaded",
        );
      },
    );
  }, []);
  return (
    <section className="panel instructions">
      <h2>Agent instructions</h2>
      <p className="sub">Read only</p>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {instructions === null
        ? error === null && <p className="empty">Loading the instructions...</p>
        : blocks(instructions)}
    </section>
  );
}
