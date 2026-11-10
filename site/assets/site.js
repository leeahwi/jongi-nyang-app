// 종이냥 — page behaviour: theme switch, top bar (tone and hide on scroll), phone menu, the scene backdrop,
// the screen chips in the tour, tab panels, the typing input line, films, Korean line ends, the privacy contents,
// and sections easing in. Everything still reads without this script.
(() => {
  const root = document.documentElement;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Theme: auto follows the system; day or night is remembered for this visitor.
  const themeButtons = document.querySelectorAll("[data-theme-set]");
  const showTheme = (mode) => themeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === mode)));
  let saved = "auto";
  try { saved = localStorage.getItem("theme") || "auto"; } catch {}
  showTheme(saved);
  themeButtons.forEach((b) => b.addEventListener("click", () => {
    const mode = b.dataset.themeSet;
    if (mode === "auto") root.removeAttribute("data-theme"); else root.dataset.theme = mode;
    try { mode === "auto" ? localStorage.removeItem("theme") : localStorage.setItem("theme", mode); } catch {}
    showTheme(mode);
  }));

  // Phone menu: a panel under the bar; Escape or a link closes it.
  const bar = document.querySelector("[data-bar]");
  const menuBtn = document.querySelector(".menu-btn");
  const menu = document.getElementById("menu");
  const setMenu = (open) => {
    if (!menu) return;
    menu.classList.toggle("open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    if (open) bar.dataset.hidden = "false";
  };
  menuBtn?.addEventListener("click", () => setMenu(menuBtn.getAttribute("aria-expanded") !== "true"));
  menu?.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && menu?.classList.contains("open")) { setMenu(false); menuBtn.focus(); } });

  // Scenes: a sticky backdrop under the sections fades from paper to a dimmed picture ([data-scene="dim"]) and
  // then to dark ([data-scene="dark"]) as the first section of each scene comes up the screen.
  const zone = document.querySelector("[data-zone]");
  const firstDim = zone?.querySelector('[data-scene="dim"]');
  const firstDark = zone?.querySelector('[data-scene="dark"]');
  const backdrop = zone?.querySelector(".backdrop");
  const stage = document.querySelector(".hero .stage, .page-stage");
  const stageDark = !!stage?.classList.contains("page-stage");
  const darkBands = [...document.querySelectorAll(".psec.dark")];
  const fadeFor = (el, vh) => {
    if (!el) return 0;
    const t = clamp((vh * 0.85 - el.getBoundingClientRect().top) / (vh * 0.3), 0, 1); // over 30% of the screen
    return calm ? (t < 0.5 ? 0 : 1) : Math.round(t * 1000) / 1000;
  };

  // Top bar: clear over the first stage, frosted paper below it, frosted dark over a dark scene; it slides away
  // while you read down and comes back as soon as you scroll up.
  let lastY = scrollY;
  const frame = () => {
    const vh = innerHeight, y = scrollY;
    let dim = 0, dark = 0;
    if (zone) {
      dim = fadeFor(firstDim, vh);
      dark = fadeFor(firstDark, vh);
      zone.style.setProperty("--dim-fade", dim);
      zone.style.setProperty("--dark-fade", dark);
      backdrop?.classList.toggle("end", zone.getBoundingClientRect().bottom <= vh + 1);
    }
    if (bar) {
      const barH = bar.offsetHeight;
      const overStage = stage && stage.getBoundingClientRect().bottom > barH + 40;
      const inDarkScene = zone && Math.max(dim, dark) >= 0.5 && zone.getBoundingClientRect().bottom > barH;
      const overBand = darkBands.some((b) => { const r = b.getBoundingClientRect(); return r.top < barH && r.bottom > barH; });
      bar.dataset.tone = overStage ? (stageDark ? "clear-dark" : "clear") : inDarkScene || overBand ? "dark" : "paper";
      if (!menu?.classList.contains("open") && !bar.contains(document.activeElement)) {
        if (y > lastY + 6 && y > 240) bar.dataset.hidden = "true";
        else if (y < lastY - 6 || y <= 240) bar.dataset.hidden = "false";
      }
    }
    lastY = y;
  };
  let queued = false;
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; frame(); }); } };
  addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue);
  frame();

  // Tab panels that swap with [hidden] (the input line examples).
  document.querySelectorAll("[data-tabs]").forEach((box) => {
    const tabs = [...box.querySelectorAll('[role="tab"]')];
    const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
    let at = 0;
    const select = (i, focus) => {
      at = (i + tabs.length) % tabs.length;
      tabs.forEach((t, j) => {
        const on = j === at;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      if (focus) tabs[at].focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(i));
      t.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (step) { e.preventDefault(); select(at + step, true); }
        if (e.key === "Home") { e.preventDefault(); select(0, true); }
        if (e.key === "End") { e.preventDefault(); select(tabs.length - 1, true); }
      });
    });
    select(0);
  });

  // Tour: chips under one window. The current chip fills as its screen plays, then the next one slides to the
  // middle. It waits while the pointer or focus is on it, off screen, or in a background tab; picking a chip by
  // hand stops it for good. With less motion asked for, it never moves on by itself.
  document.querySelectorAll("[data-show]").forEach((show) => {
    const tabs = [...show.querySelectorAll('[role="tab"]')];
    const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
    const track = show.querySelector('[role="tablist"]');
    const view = show.querySelector(".chips");
    const SPAN = 6500;
    let at = 0, p = 0, stopped = calm, hovering = false, visible = false, last = 0;
    const centre = () => {
      const t = tabs[at];
      track.style.transform = `translateX(${Math.round(view.clientWidth / 2 - (t.offsetLeft + t.offsetWidth / 2))}px)`;
    };
    const select = (i, focus) => {
      at = (i + tabs.length) % tabs.length;
      p = 0;
      tabs.forEach((t, j) => {
        const on = j === at;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        t.style.setProperty("--p", on && stopped ? 1 : 0);
        panels[j].classList.toggle("on", on);
      });
      centre();
      if (focus) tabs[at].focus({ preventScroll: true });
    };
    const byHand = (i, focus) => { stopped = true; select(i, focus); };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => byHand(i));
      t.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (step) { e.preventDefault(); byHand(at + step, true); }
        if (e.key === "Home") { e.preventDefault(); byHand(0, true); }
        if (e.key === "End") { e.preventDefault(); byHand(tabs.length - 1, true); }
      });
    });
    show.addEventListener("pointerenter", () => (hovering = true));
    show.addEventListener("pointerleave", () => (hovering = false));
    if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.4 }).observe(show);
    addEventListener("resize", centre);
    const tick = (now) => {
      const dt = last ? now - last : 0;
      last = now;
      if (!stopped && visible && !hovering && !show.contains(document.activeElement) && !document.hidden) {
        p += dt / SPAN;
        if (p >= 1) select(at + 1); else tabs[at].style.setProperty("--p", p.toFixed(4));
      }
      if (!stopped) requestAnimationFrame(tick);
    };
    select(0);
    if (!stopped) requestAnimationFrame(tick);
  });

  // The hero's input line types an example, shows how it was read, then moves on.
  const line = document.querySelector("[data-line]");
  if (line) {
    const examples = JSON.parse(line.dataset.line);
    const typed = line.querySelector(".typed");
    const chip = line.querySelector(".chip");
    if (!calm) {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      (async () => {
        await wait(1200);
        for (let i = 0; ; i = (i + 1) % examples.length) {
          const [text, reading, tone] = examples[i];
          chip.classList.add("off");
          typed.textContent = "";
          await wait(350);
          for (const ch of text) { typed.textContent += ch; await wait(ch === " " ? 60 : 110); }
          await wait(260);
          chip.textContent = reading;
          chip.classList.toggle("clay", tone === "clay");
          chip.classList.remove("off");
          await wait(2400);
        }
      })();
    }
  }

  // Videos loop silently; they wait for a click when the visitor asked for less motion. A lazy one
  // (data-film-lazy) loads and plays only while it is on screen.
  document.querySelectorAll("[data-film]").forEach((film) => {
    const toggle = film.parentElement.querySelector("[data-film-toggle]");
    if (!toggle) return;
    let chosen = false;
    const show = () => {
      const paused = film.paused;
      toggle.classList.toggle("paused", paused);
      toggle.setAttribute("aria-label", paused ? toggle.dataset.labelPlay : toggle.dataset.labelPause);
    };
    if (calm) { film.removeAttribute("autoplay"); film.pause(); }
    film.addEventListener("play", show);
    film.addEventListener("pause", show);
    toggle.addEventListener("click", () => {
      chosen = true;
      film.paused ? film.play().catch(() => {}) : film.pause();
    });
    if (!calm && film.hasAttribute("data-film-lazy") && "IntersectionObserver" in window) {
      new IntersectionObserver((entries) => entries.forEach((e) => {
        if (chosen) return;
        if (e.isIntersecting) film.play().catch(() => {}); else film.pause();
      }), { threshold: 0.35 }).observe(film);
    }
    show();
  });

  // Korean paragraphs: keep the last two words together so a line never ends the paragraph with one short word
  // (`text-wrap: pretty` doesn't catch every one). Up to 8 characters after the last space.
  if (root.lang === "ko") {
    document.querySelectorAll("main p, main li, main dd, main figcaption, footer p").forEach((el) => {
      if (el.querySelector("p, li, dd, div, ul, ol")) return;
      const nodes = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node, tail = 0;
      while ((node = walk.nextNode())) if (!node.parentElement.closest("code")) nodes.push(node);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const text = nodes[i].textContent, k = text.replace(/\s+$/, "").lastIndexOf(" ");
        if (k < 0) { tail += text.trim().length; if (tail > 8) return; continue; }
        if (tail + text.length - k - 1 <= 8) nodes[i].textContent = `${text.slice(0, k)}\u00a0${text.slice(k + 1)}`; // no-break space
        return;
      }
    });
  }

  // A page's table of contents (privacy) marks the section being read and keeps its link in view.
  const subnav = document.querySelector(".subnav");
  if (subnav && "IntersectionObserver" in window) {
    const links = [...subnav.querySelectorAll('a[href^="#"]')];
    const sections = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
    const strip = subnav.querySelector(".wrap");
    const mark = (id) => links.forEach((a) => {
      const on = a.hash === `#${id}`;
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
      if (on && strip.scrollWidth > strip.clientWidth) {
        strip.scrollTo({ left: a.offsetLeft - strip.clientWidth / 2 + a.offsetWidth / 2, behavior: calm ? "auto" : "smooth" });
      }
    });
    const visible = new Set();
    const watch = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
      const first = sections.find((s) => visible.has(s));
      if (first) mark(first.id);
    }, { rootMargin: "-150px 0px -55% 0px" });
    sections.forEach((s) => watch.observe(s));
  }

  // Sections ease in once as they scroll into view.
  const items = document.querySelectorAll(".reveal");
  if (calm || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    items.forEach((el) => io.observe(el));
  }
})();
