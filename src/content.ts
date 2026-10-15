// Texts of the site. Pasha edits this file: project cards, contacts, labels on hover.

// Clickable objects of the room. Key = object name in room.glb; parts = objects that light up together on hover.
export type Action = "project" | "contacts" | "music" | "meditation" | "lamp" | "laptop" | "book";
export const HOTSPOTS: Record<string, { label: string; hint: string; parts: string[]; action: Action }> = {
  Project_01: { label: "Jack's Lantern", hint: "открыть проект", parts: ["Project_01", "Project_01__emit"], action: "project" },
  Project_02: { label: "cyber-sigil", hint: "открыть проект", parts: ["Project_02"], action: "project" },
  Contact_Note: { label: "Контакты", hint: "написать мне", parts: ["Contact_Note", "Contact_Phone_Sticker"], action: "contacts" },
  Record_Player: { label: "Проигрыватель", hint: "включить музыку", parts: ["Record_Player"], action: "music" },
  Incense: { label: "Благовония", hint: "режим медитации", parts: ["Incense", "Incense__emit"], action: "meditation" },
  Lamp: { label: "Лампа", hint: "выключить свет", parts: ["Lamp", "Lamp__emit"], action: "lamp" },
  Laptop: { label: "Ноутбук", hint: "резюме и портфолио", parts: ["Laptop", "Laptop_Screen", "Laptop_Stand"], action: "laptop" },
  // the top book of the stack on the desk is cut out of Desk_Books on the site (Book.tsx)
  Desk_Book_Top: { label: "Пиксели души", hint: "мой телеграм-канал", parts: ["Desk_Book_Top"], action: "book" },
};

// Icons on the laptop screen. TODO(Pasha): real links. A file (resume PDF) -> put it into site/public/ and write
// its name as url without a leading slash, e.g. "resume.pdf".
export const LAPTOP_LINKS: { label: string; note: string; url: string; icon: "pdf" | "behance" | "dribbble" | "linkedin" | "github" | "web" }[] = [
  { label: "Резюме.pdf", note: "опыт, навыки, контакты", url: "resume.pdf", icon: "pdf" },
  { label: "Behance", note: "кейсы целиком", url: "https://www.behance.net/username", icon: "behance" },
  { label: "Dribbble", note: "шоты и анимации", url: "https://dribbble.com/username", icon: "dribbble" },
  { label: "LinkedIn", note: "профиль", url: "https://www.linkedin.com/in/username", icon: "linkedin" },
];
export const LAPTOP_TITLE = "Паша — senior UX/UI-дизайнер";

export interface Project {
  title: string;
  kind: string;          // game, tool, ...
  year: string;
  role: string;
  text: string[];        // paragraphs
  tags: string[];
  link?: { label: string; url: string };
}

// TODO(Pasha): real texts. Now: placeholders from what we know about the projects.
export const PROJECTS: Record<string, Project> = {
  Project_01: {
    title: "Jack's Lantern",
    kind: "Игра",
    year: "2026",
    role: "Идея, гейм-дизайн, UX/UI, арт",
    text: [
      "Днём — огород, ночью — оборона от нечисти. Историю рассказывает енот, а его говорящий фонарь светит в темноте.",
      "Здесь будет пара абзацев о задаче, решениях и о том, что получилось.",
    ],
    tags: ["game design", "UI", "pixel art"],
    link: { label: "Играть", url: "https://p4rzifalus.github.io/jacks-lantern/" },
  },
  Project_02: {
    title: "cyber-sigil",
    kind: "Инструмент для графики",
    year: "2026",
    role: "Идея, дизайн, прототип",
    text: [
      "Генератор кибер-сигилов: собирает знак из простых форм и правил.",
      "Здесь будет описание задачи, процесса и результата.",
    ],
    tags: ["generative", "tool", "graphics"],
  },
};

// TODO(Pasha): real contacts
export const CONTACTS: { label: string; value: string; url: string }[] = [
  { label: "Telegram", value: "@username", url: "https://t.me/username" },
  { label: "Почта", value: "mail@example.com", url: "mailto:mail@example.com" },
  { label: "Behance", value: "behance.net/username", url: "https://behance.net/username" },
];

// Menu buttons (top of the screen; on phones at the bottom). Order = order on screen. `icon` = picture in
// site/public/ui/<icon>.png if it exists (generated icons), otherwise the built-in line icon of the same name.
export type MenuAction = "reveal" | "shelf" | "laptop" | "book" | "contacts" | "music" | "lamp" | "meditation" | "gyro";
export const MENU: { id: MenuAction; label: string; icon: string; phoneOnly?: boolean }[] = [
  { id: "reveal", label: "Что можно нажать", icon: "reveal" },
  { id: "shelf", label: "Проекты", icon: "shelf" },
  { id: "laptop", label: "Резюме", icon: "laptop" },
  { id: "book", label: "Канал", icon: "book" },
  { id: "contacts", label: "Контакты", icon: "contacts" },
  { id: "music", label: "Музыка", icon: "music" },
  { id: "lamp", label: "Свет", icon: "lamp" },
  { id: "meditation", label: "Медитация", icon: "meditation" },
  { id: "gyro", label: "Гироскоп", icon: "gyro", phoneOnly: true },
];
