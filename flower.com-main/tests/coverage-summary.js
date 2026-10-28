// Turns an lcov.info file into a Markdown table (for the GitHub Actions job summary).
//   node coverage-summary.js <lcov.info> <title>
const fs = require("node:fs");
const path = require("node:path");

const [file, title = "Coverage"] = process.argv.slice(2);
const rows = [];
let current = null;
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("SF:")) current = { file: line.slice(3), lines: [0, 0], branches: [0, 0], functions: [0, 0] };
    else if (current && /^(LH|LF|BRH|BRF|FNH|FNF):/.test(line)) {
        const [key, value] = line.split(":");
        const target = { LH: ["lines", 0], LF: ["lines", 1], BRH: ["branches", 0], BRF: ["branches", 1], FNH: ["functions", 0], FNF: ["functions", 1] }[key];
        current[target[0]][target[1]] = Number(value);
    } else if (line === "end_of_record" && current) {
        rows.push(current);
        current = null;
    }
}

const percent = ([hit, found]) => (found ? `${((hit / found) * 100).toFixed(1)}%` : "–");
const total = (key) => rows.reduce((sum, row) => [sum[0] + row[key][0], sum[1] + row[key][1]], [0, 0]);
const name = (file) => path.relative(path.join(__dirname, ".."), file);

console.log(`### ${title}\n`);
console.log("| File | Dòng | Nhánh | Hàm |\n|---|---|---|---|");
rows.sort((a, b) => name(a.file).localeCompare(name(b.file)))
    .forEach((row) => console.log(`| ${name(row.file)} | ${percent(row.lines)} | ${percent(row.branches)} | ${percent(row.functions)} |`));
console.log(`| **Tổng** | **${percent(total("lines"))}** | **${percent(total("branches"))}** | **${percent(total("functions"))}** |\n`);
