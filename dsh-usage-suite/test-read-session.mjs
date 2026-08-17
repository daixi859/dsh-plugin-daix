// Read a dsh session log (session.jsonl.zstd, possibly multi-frame) and print
// the provider/model evidence: the last request/header + any provider mentions.
import { readFileSync } from "node:fs";
import { ZstdDecompress } from "node:zlib";

const path = process.argv[2];
const buf = readFileSync(path);

const events = await new Promise((resolve, reject) => {
	const chunks = [];
	const stream = new ZstdDecompress();
	stream.on("data", (chunk) => chunks.push(chunk));
	stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
	stream.on("error", reject);
	stream.end(buf);
});
const lines = events.split("\n").filter((line) => line.trim().length > 0);
console.log("bytes:", Buffer.byteLength(events), "lines:", lines.length);

const parsed = [];
for (const line of lines) {
	try {
		parsed.push(JSON.parse(line));
	} catch {}
}

const events = parsed;
console.log("first line:", lines[0]?.slice(0, 300));
console.log("request/header count:", headers.length);
const lastHeader = headers[headers.length - 1];
if (lastHeader !== undefined) {
	console.log("last request/header (truncated):", JSON.stringify(lastHeader).slice(0, 800));
}

const providerMentions = events.filter((e) => JSON.stringify(e).includes("provider"));
console.log("events mentioning provider:", providerMentions.length);
for (const event of providerMentions.slice(-3)) {
	console.log("  ", JSON.stringify(event).slice(0, 500));
}
