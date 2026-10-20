// Writes 256px copies of the 1024px pet art to assets/pet/256 (the cat is drawn at 92px, so
// this covers up to ~2.8× display scaling). Only the copies ship. Run: npx electron tools/pet-art.cjs
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const source = path.join(__dirname, "..", "assets", "pet");
const target = path.join(source, "256");

app.whenReady().then(() => {
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source).filter((file) => file.endsWith(".png"))) {
    const image = nativeImage.createFromPath(path.join(source, name)).resize({ width: 256, height: 256, quality: "best" });
    fs.writeFileSync(path.join(target, name), image.toPNG());
  }
  app.quit();
});
