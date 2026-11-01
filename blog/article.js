// /blog/article.js
//
// Draws a BirdBox blog post: title, byline, picture, every block (text,
// headings, pictures, videos, files), the author and the references. Used
// by the public post page (/blog/<slug>/) and by the Blog tab in BirdBox
// Learn, so the two always show a post the same way (Nathan, 1 Nov 2026).
// Each page brings its own styles and its own extras around the post.
//
//   renderArticle(post, container, fileUrl)
//     post       a blog_posts row (title, excerpt, hero_path, blocks,
//                author_name, author_bio, author_photo_path,
//                references_text, published_at)
//     fileUrl    path in the "blog" bucket -> public URL

let fileUrl = () => null;

const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleDateString("en-GB",
      { day: "numeric", month: "long", year: "numeric" })
  : "";

const initials = (name) => String(name || "")
  .split(/\s+/).filter(Boolean).slice(0, 2)
  .map((w) => w[0]).join("").toUpperCase();

// Accepts whatever a writer pastes — a watch link, a share link, an
// embed link — and returns the one form an iframe will play.
function embedUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) return null;

  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
  );
  if (yt) return "https://www.youtube.com/embed/" + yt[1];

  const vim = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vim) return "https://player.vimeo.com/video/" + vim[1];

  return null;
}

function face(name, path, cls) {
  const el = document.createElement("span");
  el.className = "art__face" + (cls ? " " + cls : "");
  el.textContent = initials(name);
  const url = fileUrl(path);
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.onload = () => { el.textContent = ""; el.append(img); };
    img.onerror = () => {};
  }
  return el;
}

// Blank lines become separate paragraphs, which is how anyone writing
// into a plain box expects it to come out.
function paragraphs(text) {
  const frag = document.createDocumentFragment();
  for (const part of String(text || "").split(/\n{2,}/)) {
    const clean = part.trim();
    if (!clean) continue;
    const p = document.createElement("p");
    // A single newline inside a paragraph is a line break, not a gap.
    const lines = clean.split("\n");
    lines.forEach((line, i) => {
      if (i) p.append(document.createElement("br"));
      p.append(document.createTextNode(line));
    });
    frag.append(p);
  }
  return frag;
}

function renderBlock(b) {
  if (b.type === "heading") {
    if (!b.text) return null;
    const h = document.createElement("h2");
    h.textContent = b.text;
    return h;
  }

  if (b.type === "subheading") {
    if (!b.text) return null;
    const h = document.createElement("h3");
    h.textContent = b.text;
    return h;
  }

  if (b.type === "text") {
    if (!b.text) return null;
    const wrap = document.createElement("div");
    wrap.append(paragraphs(b.text));
    return wrap;
  }

  if (b.type === "image") {
    const url = fileUrl(b.path);
    if (!url) return null;
    const fig = document.createElement("figure");
    if (b.width === "full") fig.className = "full";
    const img = document.createElement("img");
    img.src = url;
    img.alt = b.caption || "";
    img.loading = "lazy";
    // Marked once the file is actually measured, so the caption can be
    // centred under a centred picture. The CSS already holds the
    // height; this is only about how it sits on the page.
    img.addEventListener("load", () => {
      if (img.naturalHeight > img.naturalWidth) fig.classList.add("portrait");
    });
    fig.append(img);
    if (b.caption) {
      const cap = document.createElement("figcaption");
      cap.textContent = b.caption;
      fig.append(cap);
    }
    return fig;
  }

  if (b.type === "video") {
    const fig = document.createElement("figure");
    if (b.width === "full") fig.className = "full";

    if (b.kind === "file") {
      const url = fileUrl(b.path);
      if (!url) return null;
      const v = document.createElement("video");
      v.className = "vid";
      v.controls = true;
      v.preload = "metadata";
      v.playsInline = true;
      const src = document.createElement("source");
      src.src = url;
      v.append(src);
      fig.append(v);
    } else {
      const src = embedUrl(b.url);
      if (!src) return null;
      const box = document.createElement("div");
      box.className = "embed";
      const frame = document.createElement("iframe");
      frame.src = src;
      frame.loading = "lazy";
      frame.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture";
      frame.allowFullscreen = true;
      frame.title = b.caption || "Video";
      box.append(frame);
      fig.append(box);
    }

    if (b.caption) {
      const cap = document.createElement("figcaption");
      cap.textContent = b.caption;
      fig.append(cap);
    }
    return fig;
  }

  if (b.type === "file") {
    const href = b.path ? fileUrl(b.path) : (b.url || null);
    if (!href) return null;
    const a = document.createElement("a");
    a.className = "art__file";
    a.href = href;
    a.textContent = (b.label || "Download") + " \u2192";
    // An uploaded file downloads; a link goes wherever it points.
    if (b.path) a.setAttribute("download", "");
    else { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  }

  return null;
}


export function renderArticle(post, art, toUrl) {
  fileUrl = toUrl;
  art.textContent = "";

  const eyebrow = document.createElement("p");
  eyebrow.className = "art__eyebrow";
  eyebrow.textContent = "BirdBox Coaching";
  art.append(eyebrow);

  const h1 = document.createElement("h1");
  h1.className = "art__title";
  h1.textContent = post.title || "Untitled";
  art.append(h1);

  if (post.excerpt) {
    const stand = document.createElement("p");
    stand.className = "art__standfirst";
    stand.textContent = post.excerpt;
    art.append(stand);
  }

  if (post.author_name || post.published_at) {
    const by = document.createElement("div");
    by.className = "art__byline";
    by.append(face(post.author_name, post.author_photo_path));
    const who = document.createElement("span");
    const name = document.createElement("span");
    name.className = "art__who";
    name.style.display = "block";
    name.textContent = post.author_name || "BirdBox Coaching";
    const when = document.createElement("span");
    when.className = "art__when";
    when.style.display = "block";
    when.textContent = fmtDate(post.published_at);
    who.append(name, when);
    by.append(who);
    art.append(by);
  }

  const hero = fileUrl(post.hero_path);
  if (hero) {
    const img = document.createElement("img");
    img.className = "art__hero";
    img.src = hero;
    img.alt = "";
    art.append(img);
  }

  for (const b of Array.isArray(post.blocks) ? post.blocks : []) {
    const el = renderBlock(b);
    if (el) art.append(el);
  }

  if (post.author_bio) {
    const about = document.createElement("div");
    about.className = "art__about";
    about.append(face(post.author_name, post.author_photo_path));
    const body = document.createElement("div");
    body.className = "body";
    const h4 = document.createElement("h4");
    h4.textContent = "About the author";
    const nm = document.createElement("div");
    nm.className = "name";
    nm.textContent = post.author_name || "BirdBox Coaching";
    const p = document.createElement("p");
    p.textContent = post.author_bio;
    body.append(h4, nm, p);
    about.append(body);
    art.append(about);
  }

  if (post.references_text) {
    const refs = document.createElement("div");
    refs.className = "art__refs";
    const h4 = document.createElement("h4");
    h4.textContent = "References";
    refs.append(h4);
    // One per line, and anything that is plainly a URL is made
    // tappable rather than left as text to copy out by hand.
    for (const line of post.references_text.split("\n")) {
      const clean = line.trim();
      if (!clean) continue;
      const p = document.createElement("p");
      if (/^https?:\/\/\S+$/i.test(clean)) {
        const a = document.createElement("a");
        a.href = clean;
        a.textContent = clean;
        a.target = "_blank";
        a.rel = "noopener";
        p.append(a);
      } else {
        p.textContent = clean;
      }
      refs.append(p);
    }
    art.append(refs);
  }

}
