import { useEffect, useRef, useState } from "react";
import { CONTACTS, HOTSPOTS, LAPTOP_LINKS, LAPTOP_TITLE, PROJECTS } from "./content";
import { laptopScreen } from "./Laptop";
import { bookAssets, bookScreenSize } from "./Book";
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
      <LaptopScreen />
      <BookOverlay />
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
  const lamp = useStore((s) => s.lamp);
  const hint = h?.action === "music" && music ? "выключить музыку" : h?.action === "lamp" && !lamp ? "включить свет" : h?.hint;
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

const BASE = import.meta.env.BASE_URL;
const href = (url: string) => (/^[a-z]+:/.test(url) ? url : BASE + url);

// --- laptop: a little desktop laid onto the 3D screen (Laptop.tsx moves it every frame)
const ICONS: Record<string, { glyph: string; bg: string }> = {
  pdf: { glyph: "PDF", bg: "#c8553d" }, behance: { glyph: "Bē", bg: "#2f5fd0" }, dribbble: { glyph: "◍", bg: "#c94f7c" },
  linkedin: { glyph: "in", bg: "#2a6aa8" }, github: { glyph: "⌥", bg: "#3b3346" }, web: { glyph: "↗", bg: "#3f8f86" },
};
function LaptopScreen() {
  const mode = useStore((s) => s.mode);
  const ready = useStore((s) => s.laptopReady);
  const on = mode.kind === "laptop";
  const small = window.innerWidth / window.innerHeight < 0.9;
  laptopScreen.w = small ? 640 : 1200;
  laptopScreen.h = Math.round(laptopScreen.w * laptopScreen.ratio);
  const [time, setTime] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 15000); return () => clearInterval(t); }, []);
  return (
    <>
      {on && <div className="dismiss" onClick={closeAll} />}
      <div ref={(el) => { laptopScreen.el = el; }} className={"laptop-screen" + (on && ready ? " on" : "") + (small ? " small" : "")}
        style={{ width: laptopScreen.w, height: laptopScreen.h }}>
        <div className="os-bar">
          <span>◐ pasha.os</span>
          <span>{time.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div className="os-window">
          <div className="os-title"><i /><i /><i /><span>портфолио</span></div>
          <div className="os-body">
            <h1>{LAPTOP_TITLE}</h1>
            <p>Резюме, кейсы и профили — выбирай, куда заглянуть.</p>
            <div className="os-icons">
              {LAPTOP_LINKS.map((l) => (
                <a key={l.label} href={href(l.url)} target="_blank" rel="noreferrer">
                  <b style={{ background: ICONS[l.icon].bg }}>{ICONS[l.icon].glyph}</b>
                  <span>{l.label}</span>
                  <small>{l.note}</small>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
      {on && ready && <button className="back-pill" onClick={closeAll}>← к комнате · Esc</button>}
    </>
  );
}

// --- book: the Telegram channel. Takes the place of the 3D book (Book.tsx) in front of the camera, then opens.
interface Channel {
  url: string; title: string; description: string; subscribers: string | null; avatar: string | null;
  posts: { id: number; url: string; date: string; title: string | null; text: string; photo: string | null }[];
}
let channelCache: Promise<Channel> | null = null;
const loadChannel = () => (channelCache ??= fetch(BASE + "tg/channel.json").then((r) => r.json()));
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

function BookOverlay() {
  const mode = useStore((s) => s.mode);
  const bookOpen = useStore((s) => s.bookOpen);
  const [open, setOpen] = useState(false);
  const [ch, setCh] = useState<Channel | null>(null);
  const [size, setSize] = useState(() => bookScreenSize(window.innerWidth, window.innerHeight));
  useEffect(() => { loadChannel().then(setCh).catch(() => {}); }, []);
  useEffect(() => {
    const r = () => setSize(bookScreenSize(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);
  // opens right after the swap; closing: the cover shuts, then the 3D book takes over again and flies home
  useEffect(() => {
    if (!bookOpen) { setOpen(false); return; }
    if (mode.kind === "book") {
      setSize(bookScreenSize(window.innerWidth, window.innerHeight));
      const t = setTimeout(() => setOpen(true), 120);
      return () => clearTimeout(t);
    }
    setOpen(false);
    const t = setTimeout(() => store.set({ bookOpen: false }), 850);
    return () => clearTimeout(t);
  }, [bookOpen, mode.kind]);
  if (!bookOpen) return null;

  const portrait = window.innerWidth / window.innerHeight < 0.9;
  const head = ch && (
    <div className="tg-head">
      {ch.avatar && <img src={BASE + ch.avatar} alt="" />}
      <div className="kicker">мой телеграм-канал</div>
      <h2>{ch.title}</h2>
      <p>{ch.description}</p>
      {ch.subscribers && <div className="subs">{ch.subscribers} {plural(+ch.subscribers, "читатель", "читателя", "читателей")}</div>}
      <a className="btn" href={ch.url} target="_blank" rel="noreferrer">Открыть канал →</a>
    </div>
  );
  return (
    <div className="book-stage" onClick={closeAll}>
      <div className={"book" + (open ? " open" : "") + (portrait ? " portrait" : "")} onClick={(e) => e.stopPropagation()}
        style={{ width: size.w * 2, height: size.h, marginLeft: -size.w, marginTop: -size.h / 2,
                 ["--u" as string]: String(size.h / 600) }}>
        <div className="page right">
          {portrait && head}
          <div className="kicker">последние записи</div>
          {ch?.posts.map((p) => (
            <a key={p.id} className="post" href={p.url} target="_blank" rel="noreferrer">
              {p.photo && <img src={BASE + p.photo} alt="" />}
              <div>
                <time>{new Date(p.date).toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" })}</time>
                {p.title && <b>{p.title}</b>}
                <span>{p.text}</span>
              </div>
            </a>
          ))}
        </div>
        <div className="cover">
          <div className="face front" style={{ backgroundImage: bookAssets.cover ? `url(${bookAssets.cover})` : undefined }} />
          <div className="face back">{!portrait && head}</div>
        </div>
        <button className="close" onClick={closeAll} aria-label="Закрыть">×</button>
      </div>
    </div>
  );
}
