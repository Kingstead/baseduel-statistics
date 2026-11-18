// Exercise the real TypeScript without a second implementation or test runtime.
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: 'export * from "./killlog"; export { highlights, highlightLeaders, sortBoardRows } from "./board";',
    resolveDir: new URL("../src", import.meta.url).pathname, loader: "ts",
  },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "error",
});
const { playerKills, playerStreaks, minuteKills,
  highlights, highlightLeaders, sortBoardRows } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const kill = (t, killer, killed, teamKill = false, weapon = "bullet") => ({
  t, killer, killed, teamKill, weapon, killerFreq: 0, killedFreq: teamKill ? 0 : 1,
});
const kills = [
  kill(100, "Ann", "Bob"),
  kill(200, "ANN", "bob", false, "burst"),
  kill(300, "Ann", "Cy", true),
  kill(400, "Bob", "ann"),
  kill(500, "Cy", "Ann", true),
  kill(600, "Ann", "Ann", true),
];
const mine = playerKills(kills, "ann");
assert.deepEqual(mine.killed.map(({ name, n }) => [name, n]), [["Bob", 2]]);
assert.equal(mine.kills + mine.teamKilled.reduce((n, v) => n + v.n, 0), 3);
assert.equal(mine.deaths + mine.teamKilledBy.reduce((n, v) => n + v.n, 0), 2);
assert.deepEqual(mine.killed[0].weapons, { bullet: 1, burst: 1 });
assert.equal(playerKills(kills, "Ann", [200, 300]).kills, 1);
assert.equal(playerKills(kills, "Nobody").kills, 0);

// Team kills do not advance a reconstructed streak, but a team death or
// suicide resets it. A qualifying enemy streak is credited to its ender.
const run = Array.from({ length: 10 }, (_, i) => kill(i + 1, "Bob", `Victim ${i}`));
const streakLog = [
  ...run,
  kill(11, "Bob", "Cy", true),
  kill(12, "Ann", "BOB"),
  kill(13, "Ann", "Cy", true),
  kill(14, "Ann", "Bob"),
  kill(15, "Cy", "Ann", true),
  kill(16, "Ann", "Bob"),
  kill(17, "Ann", "Ann", true),
  kill(18, "Ann", "Bob"),
];
const ann = playerStreaks(streakLog, "ANN");
assert.deepEqual(ann.streaks.map((s) => s.kills.length), [2, 1, 1]);
assert.equal(ann.ended.length, 1);
assert.equal(ann.ended[0].kills.length, 10);
assert.equal(ann.ended[0].endedBy.t, 12);
assert.equal(playerStreaks(streakLog, "Ann", [5, 13]).ended.length, 0);
assert.equal(playerStreaks(streakLog, "Ann", [14, 15]).streaks[0].kills.length, 1);
assert.equal(playerStreaks(streakLog.map((k) => k.t === 12 ? { ...k, teamKill: true } : k), "Ann").ended.length, 0);
assert.deepEqual(playerStreaks([], "Ann"), { streaks: [], ended: [] });

// Quiet minutes must survive; boundary kills belong to the next minute.
// The last bucket is a count for a partial minute, not a fabricated KPM.
const minutes = minuteKills([
  kill(99, "Ann", "Bob"), kill(100, "ANN", "Bob"),
  kill(6099, "Ann", "Cy", true), kill(12100, "Ann", "Bob"),
  kill(12500, "Ann", "Bob"), kill(200, "Bob", "Ann"),
], "ann", [100, 12500]);
assert.deepEqual(minutes, [
  { start: 100, end: 6100, kills: 2 },
  { start: 6100, end: 12100, kills: 0 },
  { start: 12100, end: 12500, kills: 1 },
]);
assert.deepEqual(minuteKills([], "Ann", [100, 100]), []);
assert.deepEqual(minuteKills([kill(6000, "Ann", "Bob")], "Ann", [0, 12000]).map((m) => m.kills), [0, 1]);

// Rankings are numeric (10 before 2), retain every tied player, and put
// unknown values after genuine zeroes without turning them into zeroes.
const ranked = highlightLeaders("Kills", "Numeric", [
  { player_name: "Zoe", score: 10 }, { player_name: "Bob", score: 2 },
  { player_name: "Ann", score: 10 }, { player_name: "Zero", score: 0 },
  { player_name: "Unknown", score: null },
], (r) => r.score);
assert.deepEqual(ranked.ranking, [
  { name: "Ann", value: "10" }, { name: "Zoe", value: "10" },
  { name: "Bob", value: "2" }, { name: "Zero", value: "0" },
  { name: "Unknown", value: null },
]);
const boardHighlights = highlights([
  { player_name: "Zoe", kills: 20, deaths: 1, teamkills: 0, active_time: 6000, attached_to: null },
  { player_name: "Ann", kills: 4, deaths: 1, teamkills: 0, active_time: 599, attached_to: 4 },
  { player_name: "Zero", kills: 0, deaths: 0, active_time: 0, attached_to: 0 },
  { player_name: "Missing" },
]);
assert.deepEqual(boardHighlights.find((h) => h.label === "Highest rated").ranking, [
  { name: "Zoe", value: "10.00" }, { name: "Ann", value: "2.00" },
  { name: "Missing", value: "0.00" }, { name: "Zero", value: "0.00" },
]);
assert.deepEqual(boardHighlights.find((h) => h.label === "Most attached to").ranking, [
  { name: "Ann", value: "4" }, { name: "Zero", value: "0" },
  { name: "Missing", value: null }, { name: "Zoe", value: null },
]);
assert.equal(boardHighlights.find((h) => h.label === "Most field time").ranking[0].value, "100m 00s");

// Replay moments augment the existing bot ranking; reconstructed endings
// must never replace its scoreboard values or exclude zero-valued players.
const endings = [{ start: 500, end: 1000, label: "Ended Bob's 10-kill streak" }];
const endingHighlight = highlights([
  { player_name: "ANN", streak_ends: 4 },
  { player_name: "Bob", streak_ends: 0 },
], { ann: endings }).find((h) => h.label === "Most streaks ended");
assert.equal(endingHighlight.value, "4");
assert.equal(endingHighlight.ranking[0].value, "4");
assert.deepEqual(endingHighlight.ranking[0].moments, endings);
assert.equal(endingHighlight.ranking[1].moments, undefined);
assert.equal(highlights([{ player_name: "Ann", streak_ends: 4 }])
  .find((h) => h.label === "Most streaks ended").ranking[0].moments, undefined);

// Sorting compares displayed numbers and elapsed time numerically, not
// lexically; it preserves the board and leaves untracked cells last.
const boardRows = [
  { name: "Ann", marker: null, cells: [2, "10.00", "10:00 (80%)", "-"] },
  { name: "Bob", marker: "S", cells: [10, "2.00", "9:59 (100%)", 0] },
  { name: "Cy", marker: null, cells: [0, "-", "1:00 (100%)", 12] },
];
const sortedNames = (column, direction) => sortBoardRows(boardRows, column, direction).map((r) => r.name);
assert.deepEqual(sortedNames(0, "descending"), ["Bob", "Ann", "Cy"]);
assert.deepEqual(sortedNames(0, "ascending"), ["Cy", "Ann", "Bob"]);
assert.deepEqual(sortedNames(1, "descending"), ["Ann", "Bob", "Cy"]);
assert.deepEqual(sortedNames(1, "ascending"), ["Bob", "Ann", "Cy"]);
assert.deepEqual(sortedNames(2, "descending"), ["Ann", "Bob", "Cy"]);
assert.deepEqual(sortedNames(2, "ascending"), ["Cy", "Bob", "Ann"]);
assert.deepEqual(sortedNames(3, "descending"), ["Cy", "Bob", "Ann"]);
assert.deepEqual(sortedNames(3, "ascending"), ["Bob", "Cy", "Ann"]);
const mixedNames = ["zed", "Ann", "BOB"].map((name) => ({ name, marker: null, cells: [1] }));
assert.deepEqual(sortBoardRows(mixedNames, -1, "ascending").map((r) => r.name), ["Ann", "BOB", "zed"]);
assert.deepEqual(sortBoardRows(mixedNames, -1, "descending").map((r) => r.name), ["zed", "BOB", "Ann"]);
assert.deepEqual(boardRows.map((r) => r.name), ["Ann", "Bob", "Cy"]);
console.log("killlog drilldowns: ok");
