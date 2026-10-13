import { useEffect, useRef } from "react";
import { CONTACTS, HOTSPOTS, PROJECTS } from "./content";
import { closeAll, store, useStore } from "./store";
import { toggleMusic } from "./music";
import "./overlay.css";

// HTML on top of the 3D room: label at the cursor, project card, contacts note, meditation screen, music badge.
export default function Overlay() {
  const mode = useStore((s) => s.mode);
  const music = useStore((s) => s.music);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closeAll(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <div className="ui">
      <HoverLabel />
      {mode.kind === "project" && <ProjectCard id={mode.id} key={mode.id} />}
      {mode.kind === "contacts" && <Contacts />}
      <Meditation on={mode.kind === "meditation"} />
      {music && mode.kind !== "meditation" && (
        <button className="music-badge" onClick={toggleMusic} title="Выключить музыку">
          <span className="eq"><i /><i /><i /></span>играет музыка
        </button>
      )}
    </div>
  );
}

function HoverLabel() {
  const hovered = useStore((s) => s.hovered);
  const music = useStore((s) => s.music);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (ref.current) ref.current.style.transform = `translate(${e.clientX + 18}px, ${e.clientY + 14}px)`;
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);
  const h = hovered ? HOTSPOTS[hovered] : null;
  const hint = h?.action === "music" && music ? "выключить музыку" : h?.hint;
  return (
    <div ref={ref} className={"hover-label" + (h ? " on" : "")}>
      {h && <><b>{h.label}</b><span>{hint}</span></>}
    </div>
  );
}

function ProjectCard({ id }: { id: string }) {
  const p = PROJECTS[id];
  if (!p) return null;
  return (
    <aside className="card project" onPointerDown={(e) => e.stopPropagation()}>
      <button className="close" onClick={closeAll} aria-label="Закрыть">×</button>
      <div className="meta">{p.kind} · {p.year}</div>
      <h2>{p.title}</h2>
      <div className="role">{p.role}</div>
      {p.text.map((t, i) => <p key={i}>{t}</p>)}
      <div className="tags">{p.tags.map((t) => <span key={t}>{t}</span>)}</div>
      {p.link && <a className="btn" href={p.link.url} target="_blank" rel="noreferrer">{p.link.label} →</a>}
      <div className="drag-hint">потяни, чтобы покрутить · Esc — назад</div>
    </aside>
  );
}

function Contacts() {
  return (
    <div className="backdrop" onClick={closeAll}>
      <div className="note" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={closeAll} aria-label="Закрыть">×</button>
        <h2>Напиши мне</h2>
        <p className="lead">Открыт к интересным задачам — продукт, игры, всё уютное.</p>
        <ul>
          {CONTACTS.map((c) => (
            <li key={c.label}><span>{c.label}</span><a href={c.url} target="_blank" rel="noreferrer">{c.value}</a></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Meditation({ on }: { on: boolean }) {
  // the scene itself is 3D (Meditation.tsx); here only a quiet way back, shown after the flight
  return (
    <div className={"meditation" + (on ? " on" : "")}>
      <button className="back" onClick={closeAll}>← вернуться в комнату</button>
      <div className="leave">звучит мантра · Esc — назад</div>
    </div>
  );
}
