// Snapshot of the Telegram channel for the book on the desk: name, description, avatar, latest posts.
// Reads the public web preview t.me/s/<channel> (no API key) and writes public/tg/channel.json + images.
// Runs before every build (npm run build) and once a day on GitHub (deploy.yml). If Telegram is unreachable,
// the previous snapshot stays (the build does not fail).
import { mkdir, writeFile, readFile, readdir, unlink } from "node:fs/promises";

const CHANNEL = "soulpixels";
const POSTS = 4;
const OUT = new URL("../public/tg/", import.meta.url);

const decode = (s) => s
  .replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
const pick = (re, s) => { const m = re.exec(s); return m ? m[1] : null; };

async function download(url, name) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + " " + r.status);
  await writeFile(new URL(name, OUT), Buffer.from(await r.arrayBuffer()));
  return "tg/" + name;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const r = await fetch(`https://t.me/s/${CHANNEL}`, { headers: { "Accept-Language": "ru" } });
  if (!r.ok) throw new Error("t.me " + r.status);
  const html = await r.text();

  const title = decode(pick(/tgme_channel_info_header_title"><span[^>]*>([^<]*)/, html) ?? CHANNEL);
  const description = decode(pick(/tgme_channel_info_description">([\s\S]*?)<\/div>/, html) ?? "");
  const subscribers = pick(/counter_value">([^<]*)<\/span> <span class="counter_type">subscribers/, html);
  const avatarUrl = pick(/tgme_page_photo_image[^>]*><img src="([^"]+)"/, html);
  const avatar = avatarUrl ? await download(avatarUrl, "avatar.jpg") : null;

  // messages, newest last on the page
  const chunks = html.split('<div class="tgme_widget_message_wrap').slice(1);
  const posts = [];
  for (const c of chunks.reverse()) {
    const id = pick(/data-post="[^/]+\/(\d+)"/, c);
    const textHtml = pick(/tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/, c);
    if (!id || !textHtml) continue;
    const text = decode(textHtml).trim();
    const bold = pick(/^<b>([\s\S]*?)<\/b>/, textHtml.trim());
    const head = bold ? decode(bold).trim() : null;
    const body = (head ? text.slice(text.indexOf(head) + head.length) : text).replace(/\s+/g, " ").trim();
    const photoUrl = pick(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/, c);
    posts.push({
      id: +id,
      url: `https://t.me/${CHANNEL}/${id}`,
      date: pick(/<time datetime="([^"]+)"/, c),
      title: head,
      text: body.length > 260 ? body.slice(0, 260).replace(/\s+\S*$/, "") + "…" : body,
      photo: photoUrl ? await download(photoUrl, `post_${id}.jpg`) : null,
    });
    if (posts.length >= POSTS) break;
  }

  const data = { channel: CHANNEL, url: `https://t.me/${CHANNEL}`, title, description, subscribers, avatar, posts,
                 updated: new Date().toISOString() };
  await writeFile(new URL("channel.json", OUT), JSON.stringify(data, null, 1));
  // pictures of posts that dropped out of the latest ones
  const keep = new Set(posts.map((p) => p.photo?.slice(3)));
  for (const f of await readdir(OUT)) if (f.startsWith("post_") && !keep.has(f)) await unlink(new URL(f, OUT));
  console.log(`tg-snapshot: ${title}, ${posts.length} posts`);
}

main().catch(async (e) => {
  const old = await readFile(new URL("channel.json", OUT)).catch(() => null);
  console.warn("tg-snapshot failed:", e.message, old ? "(keeping the previous snapshot)" : "(no snapshot yet)");
});
