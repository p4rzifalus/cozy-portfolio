import { useEffect, useRef, useState } from "react";
import { MENU, MenuAction } from "./content";
import { store, useStore } from "./store";
import { toggleMusic, switchClick } from "./music";
import { enableGyro, hasGyro, rig } from "./Room";
import { Kbd } from "./Keycap";

// Menu of the site. "Show all" = outline of every clickable object (Interact.tsx), no labels (Pasha, 2026-10-15).
const UI = import.meta.env.BASE_URL + "ui/";

// placeholder line icons until the generated ones are in site/public/ui/
const LINE: Record<string, string> = {
  reveal: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M12 9a3 3 0 100 6 3 3 0 000-6z",
  shelf: "M5 3h14v18H5zM5 9h14M5 15h14M8 6.5h2M14 12.5h2",
  laptop: "M5 6h14v9H5zM3 18h18",
  book: "M4 5c3-1 6-1 8 1v13c-2-2-5-2-8-1zM20 5c-3-1-6-1-8 1v13c2-2 5-2 8-1z",
  contacts: "M6 4h12v16l-6-3-6 3z",
  music: "M9 18V6l10-2v12M9 18a2 2 0 11-4 0 2 2 0 014 0zM19 16a2 2 0 11-4 0 2 2 0 014 0z",
  lamp: "M9 3h6l3 7H6zM12 10v8M8 21h8",
  meditation: "M12 4c2 3 2 5 0 8-2-3-2-5 0-8zM4 14c4 0 6 2 8 6 2-4 4-6 8-6",
  gyro: "M8 3h8v18H8zM3 9c-1 2-1 4 0 6M21 9c1 2 1 4 0 6",
  burger: "M4 7h16M4 12h16M4 17h11",
};

function Icon({ name }: { name: string }) {
  const [img, setImg] = useState(true);
  return img
    ? <img src={UI + name + ".png"} alt="" onError={() => setImg(false)} />
    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={LINE[name]} /></svg>;
}

export default function Menu() {
  const mode = useStore((s) => s.mode);
  const music = useStore((s) => s.music);
  const lamp = useStore((s) => s.lamp);
  const reveal = useStore((s) => s.reveal);
  const gyro = useStore((s) => s.gyro);
  const phone = hasGyro();
  const [more, setMore] = useState(false);   // burger list open
  const [toast, setToast] = useState<string | null>(null);   // short message on a plate (instead of the browser alert)
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4500); return () => clearTimeout(t); }, [toast]);
  const active: Partial<Record<MenuAction, boolean>> = { music, lamp: !lamp, reveal, gyro };

  // "show all" switches itself off after a while and on any click into the room
  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(() => store.set({ reveal: false }), 8000);
    return () => clearTimeout(t);
  }, [reveal]);

  const act = async (id: MenuAction) => {
    const s = store.get();
    if (id !== "reveal" && s.reveal) store.set({ reveal: false });
    switch (id) {
      case "reveal": store.set({ reveal: !s.reveal, mode: { kind: "room" } }); break;
      case "shelf": store.set({ mode: { kind: "room" } }); rig.target = 1; break;
      case "laptop": store.set({ mode: { kind: "laptop" }, hovered: null }); break;
      case "book": store.set({ mode: { kind: "book" }, hovered: null }); break;
      case "contacts": store.set({ mode: { kind: "contacts" }, hovered: null }); break;
      case "music": toggleMusic(); break;
      case "lamp": store.set({ lamp: !s.lamp }); switchClick(); break;
      case "meditation": store.set({ mode: { kind: "meditation" }, hovered: null }); break;
      case "gyro": if (s.gyro) store.set({ gyro: false }); else if (!(await enableGyro())) setToast("Гироскоп недоступен: телефон не дал разрешение."); break;
    }
  };

  // hotkeys: the letter of each item (MENU.key, also the burger ones), Tab = burger. Only in the room
  // (other screens have Esc; Esc also closes the burger). e.code = physical key, so it works on the Russian layout too.
  const items = MENU.filter((m) => !m.phoneOnly || phone);
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || store.get().mode.kind !== "room") return;
      if (e.code === "Escape") { setMore(false); return; }
      if (e.code === "Tab") { e.preventDefault(); setMore((v) => !v); return; }
      const m = MENU.find((m) => "Key" + m.key === e.code && (!m.phoneOnly || hasGyro()));
      if (m) { setMore(false); actRef.current(m.id); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // a click anywhere outside the menu closes the list
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!more) return;
    const down = (e: PointerEvent) => { if (!nav.current?.contains(e.target as Node)) setMore(false); };
    window.addEventListener("pointerdown", down);
    return () => window.removeEventListener("pointerdown", down);
  }, [more]);

  const hidden = mode.kind !== "room";
  const pick = (id: MenuAction) => { setMore(false); act(id); };
  return (
    <>
    {toast && <div className="toast plate" role="status" onClick={() => setToast(null)}><i className="plate-bg" />{toast}</div>}
    <nav ref={nav} className={"menu" + (hidden ? " hidden" : "") + (more ? " open" : "")}>
      <i className="plate-bg" />
      {items.map((m) => m.main && (
        <button key={m.id} className={"main" + (active[m.id] ? " on" : "")} onClick={() => pick(m.id)}>
          <Kbd k={m.key} />
          <Icon name={m.icon} />
          <em>{m.label}</em>
        </button>
      ))}
      <button className={"burger" + (more ? " on" : "")} onClick={() => setMore(!more)} aria-label="Ещё" aria-expanded={more}>
        <Icon name="burger" />
        <Kbd k="Tab" />
      </button>
      <div className="more plate" role="menu">
        <i className="plate-bg" />
        {items.map((m) => !m.main && (
          <button key={m.id} role="menuitem" className={active[m.id] ? "on" : ""} onClick={() => pick(m.id)}>
            <Kbd k={m.key} />
            <Icon name={m.icon} />
            <em>{m.label}</em>
          </button>
        ))}
      </div>
    </nav>
    </>
  );
}

// first visit on a phone: offer the gyroscope once (iOS needs a tap to ask for it)
export function GyroHint() {
  const [show, setShow] = useState(false);
  const gyro = useStore((s) => s.gyro);
  const asked = useRef(false);
  useEffect(() => {
    if (!hasGyro()) return;
    let seen = false;
    try { seen = localStorage.getItem("gyroHint") === "1"; } catch { /* private mode */ }
    if (!seen) { const t = setTimeout(() => setShow(true), 2500); return () => clearTimeout(t); }
  }, []);
  if (!show || gyro) return null;
  const close = () => { setShow(false); try { localStorage.setItem("gyroHint", "1"); } catch { /* */ } };
  return (
    <div className="gyro-hint popup">
      <i className="plate-bg" />
      <span>Поворачивай телефон, чтобы осмотреться</span>
      <button className="swash" onClick={async () => { if (asked.current) return; asked.current = true; await enableGyro(); close(); }}>Включить</button>
      <button className="ghost" onClick={close}>Не надо</button>
    </div>
  );
}
