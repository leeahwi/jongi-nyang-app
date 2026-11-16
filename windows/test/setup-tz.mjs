// Loaded before every test file: `node --test --import ./test/setup-tz.mjs out-test/` (#399).
// Some shared cases are written on the developer's clock (Asia/Seoul: time ranges, search groups, spaces-cases.json).
// The files in time-zones.json get that zone whatever the machine's is. Every other file runs in the caller's TZ, or in
// UTC when none is set, so `TZ=America/Los_Angeles npm test` still shows they don't lean on the machine's zone.
import fs from "node:fs";
import path from "node:path";

const zones = JSON.parse(fs.readFileSync(new URL("./time-zones.json", import.meta.url), "utf8"));
const name = path.basename(process.argv[1] ?? "").replace(/\.test\.m?[jt]s$/, "");
const pinned = Object.keys(zones).find((zone) => zones[zone].includes(name));
if (pinned) process.env.TZ = pinned;
else if (!process.env.TZ) process.env.TZ = "UTC";
