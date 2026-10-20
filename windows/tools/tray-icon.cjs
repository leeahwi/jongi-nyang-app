// Draws the tray's cat face (assets/tray/cat-face.svg) for Windows' taskbar: one set for a light
// taskbar (ink face) and one for a dark one (warm white face), at 16 · 20 · 24 · 32 · 40 · 48 px
// (100 % to 300 % display scaling), as PNGs and as one .ico per set (32-bit BMP entries); and a
// black template image for the macOS menu bar (demo runs). The same face with a small clay dot (something
// within the hour, "-dot"). And the taskbar's pictures (assets/taskbar): the thumbnail toolbar's ⏸ ▶ ⏹ +5
// in white for the dark preview, and the overlay badge's numbers 1–9 and 9+. Run: npm run tray-icon
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const folder = path.join(__dirname, "..", "assets", "tray");
const svg = fs.readFileSync(path.join(folder, "cat-face.svg"), "utf8");
const sizes = [16, 20, 24, 32, 40, 48];
const variants = { light: "#2f2e2a", dark: "#f3efe4" };

/** An .ico of 32-bit BGRA bitmaps (bottom-up, with an empty AND mask), one per size. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const bodies = [];
  let offset = header.length;
  images.forEach(({ size, rgba }, index) => {
    const maskRow = Math.ceil(size / 32) * 4;
    const body = Buffer.alloc(40 + size * size * 4 + maskRow * size);
    body.writeUInt32LE(40, 0); body.writeInt32LE(size, 4); body.writeInt32LE(size * 2, 8);
    body.writeUInt16LE(1, 12); body.writeUInt16LE(32, 14); body.writeUInt32LE(size * size * 4 + maskRow * size, 20);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const from = (y * size + x) * 4, to = 40 + ((size - 1 - y) * size + x) * 4;
        body[to] = rgba[from + 2]; body[to + 1] = rgba[from + 1]; body[to + 2] = rgba[from]; body[to + 3] = rgba[from + 3];
      }
    }
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry); header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(body.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += body.length;
    bodies.push(body);
  });
  return Buffer.concat([header, ...bodies]);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await window.loadURL("data:text/html,<canvas></canvas>");
  // `dot`: a clay dot at the top right with a clear ring around it (something within the hour).
  const draw = (color, size, dot) => window.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(${JSON.stringify(svg.replaceAll("currentColor", color))});
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ${size};
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, ${size}, ${size});
    const dot = ${JSON.stringify(dot ?? null)};
    if (dot) {
      const unit = ${size} / 18, x = 14.7 * unit, y = 3.5 * unit, r = 2.7 * unit;
      context.globalCompositeOperation = "destination-out";
      context.beginPath(); context.arc(x, y, r + 1.1 * unit, 0, Math.PI * 2); context.fill();
      context.globalCompositeOperation = "source-over";
      context.fillStyle = dot;
      context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2); context.fill();
    }
    return { png: canvas.toDataURL("image/png"), rgba: [...context.getImageData(0, 0, ${size}, ${size}).data] };
  })()`);
  const dots = { light: "#b5583a", dark: "#f0a080" };
  for (const [variant, color] of Object.entries(variants)) {
    for (const suffix of ["", "-dot"]) {
      const images = [];
      for (const size of sizes) {
        const { png, rgba } = await draw(color, size, suffix ? dots[variant] : undefined);
        fs.writeFileSync(path.join(folder, `cat-face-${variant}${suffix}-${size}.png`), Buffer.from(png.split(",")[1], "base64"));
        images.push({ size, rgba: Buffer.from(rgba) });
      }
      fs.writeFileSync(path.join(folder, `cat-face-${variant}${suffix}.ico`), ico(images));
    }
  }
  // The taskbar (Windows): the thumbnail toolbar's buttons and the overlay badge, at 16 and 32 px.
  const taskbar = path.join(__dirname, "..", "assets", "taskbar");
  fs.mkdirSync(taskbar, { recursive: true });
  const glyphs = {
    pause: '<path d="M9 6v12M15 6v12"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="#fff"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="#fff"/>',
    plus5: '<path d="M4.5 12h7M8 8.5v7"/><path d="M19.5 6.5h-4.2l-.6 4.6c.5-.4 1.3-.7 2-.7 1.7 0 2.9 1.2 2.9 2.9 0 1.8-1.3 3-3.1 3-1.2 0-2.2-.5-2.8-1.3"/>',
  };
  const picture = (inner, size) => window.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ${JSON.stringify(inner)} + '</svg>');
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ${size};
    canvas.getContext("2d").drawImage(image, 0, 0, ${size}, ${size});
    return canvas.toDataURL("image/png");
  })()`);
  for (const [name, inner] of Object.entries(glyphs)) {
    for (const [size, suffix] of [[16, ""], [32, "@2x"]]) {
      const png = await picture(inner, size);
      fs.writeFileSync(path.join(taskbar, `${name}${suffix}.png`), Buffer.from(png.split(",")[1], "base64"));
    }
  }
  // The badge: a clay disc with the count in white (9+ for more), drawn bold and tabular.
  const badge = (text, size) => window.webContents.executeJavaScript(`(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ${size};
    const context = canvas.getContext("2d");
    const s = ${size};
    context.fillStyle = "#b5583a";
    context.beginPath(); context.arc(s / 2, s / 2, s / 2 - 0.5, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#ffffff";
    context.textAlign = "center"; context.textBaseline = "middle";
    const text = ${JSON.stringify(text)};
    const face = (scale) => "700 " + Math.round(s * scale) + "px 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
    if (text.length > 1) {
      // 9+: the 9 a little left, a small raised + beside it (still readable at 16 px).
      context.font = face(0.64);
      context.fillText("9", s * 0.42, s / 2 + s * 0.05);
      context.font = face(0.44);
      context.fillText("+", s * 0.77, s * 0.38);
    } else {
      context.font = face(0.68);
      context.fillText(text, s / 2, s / 2 + s * 0.04);
    }
    return canvas.toDataURL("image/png");
  })()`);
  for (const text of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "9+"]) {
    for (const [size, suffix] of [[16, ""], [32, "@2x"]]) {
      const png = await badge(text, size);
      fs.writeFileSync(path.join(taskbar, `badge-${text.replace("+", "plus")}${suffix}.png`), Buffer.from(png.split(",")[1], "base64"));
    }
  }
  // macOS (demo runs): a template image, black, at 1× and 2× (18 pt like the Mac app's).
  for (const [name, size] of [["catFaceTemplate.png", 18], ["catFaceTemplate@2x.png", 36]]) {
    const { png } = await draw("#000000", size);
    fs.writeFileSync(path.join(folder, name), Buffer.from(png.split(",")[1], "base64"));
  }
  app.quit();
});
