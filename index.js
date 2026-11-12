#!/usr/bin/env node
/*
 * Contribution filler: creates backdated commits on random days with a random
 * number of commits per day, so the GitHub contribution graph fills in.
 *
 * Usage:
 *   node index.js [options]
 *
 * Options (all optional):
 *   --start YYYY-MM-DD   first day (default: 365 days ago)
 *   --end   YYYY-MM-DD   last day  (default: today)
 *   --min N              min commits on an active day (default 1)
 *   --max N              max commits on an active day (default 8)
 *   --chance P           probability a weekday is active, 0..1 (default 0.65)
 *   --weekend P          probability a weekend day is active, 0..1 (default 0.35)
 *   --seed N             make the random pattern reproducible
 *   --dry-run            only print the plan, do not commit
 *   --push               git push when finished
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DATA_FILE = path.join(__dirname, "data.json");

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) opts[key] = true;
    else { opts[key] = next; i++; }
  }
  return opts;
}

// Small seedable PRNG (mulberry32) so a --seed gives the same pattern again.
function makeRandom(seed) {
  if (seed === undefined) return Math.random;
  let s = Number(seed) >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseDay(str, name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str));
  if (!m) throw new Error(`--${name} must be YYYY-MM-DD, got "${str}"`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function pad(n) { return String(n).padStart(2, "0"); }

// ISO 8601 with the local timezone offset, e.g. 2026-03-14T10:22:05+05:30
function toIsoLocal(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function buildPlan(opts) {
  const rand = makeRandom(opts.seed);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = opts.end ? parseDay(opts.end, "end") : today;
  const start = opts.start
    ? parseDay(opts.start, "start")
    : new Date(end.getFullYear() - 1, end.getMonth(), end.getDate() + 1);
  const min = Math.max(1, parseInt(opts.min ?? 1, 10));
  const max = Math.max(min, parseInt(opts.max ?? 8, 10));
  const chance = Number(opts.chance ?? 0.65);
  const weekend = Number(opts.weekend ?? 0.35);
  if (start > end) throw new Error("--start is after --end");

  const now = new Date();
  const plan = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    if (rand() >= (isWeekend ? weekend : chance)) continue;
    const count = min + Math.floor(rand() * (max - min + 1));
    const times = [];
    for (let i = 0; i < count; i++) {
      // Random time between 09:00 and 23:59
      const t = new Date(d);
      t.setHours(9 + Math.floor(rand() * 15), Math.floor(rand() * 60), Math.floor(rand() * 60));
      if (t <= now) times.push(t);
    }
    times.sort((a, b) => a - b);
    plan.push(...times);
  }
  return plan;
}

function git(args, env) {
  return execFileSync("git", args, {
    cwd: __dirname,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  }).toString().trim();
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const plan = buildPlan(opts);
  const days = new Set(plan.map((t) => t.toDateString())).size;
  console.log(`Plan: ${plan.length} commits across ${days} days` +
    (plan.length ? ` (${toIsoLocal(plan[0])} -> ${toIsoLocal(plan[plan.length - 1])})` : ""));

  if (opts["dry-run"] || plan.length === 0) return;

  plan.forEach((time, i) => {
    const iso = toIsoLocal(time);
    fs.writeFileSync(DATA_FILE, JSON.stringify({ date: iso, n: i + 1 }) + "\n");
    git(["add", "data.json"]);
    git(["commit", "-q", "-m", `update ${iso}`],
      { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
    if ((i + 1) % 50 === 0 || i === plan.length - 1) {
      console.log(`  committed ${i + 1}/${plan.length}`);
    }
  });

  if (opts.push) {
    console.log("Pushing...");
    execFileSync("git", ["push"], { cwd: __dirname, stdio: "inherit" });
  }
  console.log("Done.");
}

main();
