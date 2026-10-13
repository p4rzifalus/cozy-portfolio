// Texts of the site. Pasha edits this file: project cards, contacts, labels on hover.

// Clickable objects of the room. Key = object name in room.glb; parts = objects that light up together on hover.
export type Action = "project" | "contacts" | "music" | "meditation";
export const HOTSPOTS: Record<string, { label: string; hint: string; parts: string[]; action: Action }> = {
  Project_01: { label: "Jack's Lantern", hint: "открыть проект", parts: ["Project_01"], action: "project" },
  Project_02: { label: "cyber-sigil", hint: "открыть проект", parts: ["Project_02"], action: "project" },
  Contact_Note: { label: "Контакты", hint: "написать мне", parts: ["Contact_Note", "Contact_Phone_Sticker"], action: "contacts" },
  Record_Player: { label: "Проигрыватель", hint: "включить музыку", parts: ["Record_Player"], action: "music" },
  Incense: { label: "Благовония", hint: "режим медитации", parts: ["Incense", "Incense__emit"], action: "meditation" },
};

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
