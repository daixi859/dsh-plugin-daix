// Minimal asar reader: list/extract/search files from an .asar archive (no deps).
import { openSync, readSync, closeSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const [archive, cmd, ...rest] = process.argv.slice(2);

function readHeader(fd) {
  const sizeBuf = Buffer.alloc(16);
  readSync(fd, sizeBuf, 0, 16, 0);
  // pickle: [0-3]=4 | [4-7]=header pickle size | [8-11]=payload size | [12-15]=str len | [16..]=JSON
  const jsonSize = sizeBuf.readUInt32LE(12);
  const jsonBuf = Buffer.alloc(jsonSize);
  readSync(fd, jsonBuf, 0, jsonSize, 16);
  return { header: JSON.parse(jsonBuf.toString("utf8")), dataOffset: 8 + sizeBuf.readUInt32LE(4) };
}

function* walk(node, prefix = "") {
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (child.files) yield* walk(child, p);
      else yield { path: p, node: child };
    }
  } else {
    yield { path: prefix, node };
  }
}

const fd = openSync(archive, "r");
const { header, dataOffset } = readHeader(fd);

if (cmd === "list") {
  const re = rest[0] ? new RegExp(rest[0]) : null;
  for (const { path: p, node } of walk(header)) {
    if (!re || re.test(p)) console.log(`${node.size ?? "-"}\t${node.unpacked ? "U" : " "}\t${p}`);
  }
} else if (cmd === "extract") {
  // extract <internalPath> <outPath>
  const [ipath, out] = rest;
  let node = header;
  for (const seg of ipath.split("/")) node = node.files?.[seg];
  if (!node || node.files) { console.error("not found:", ipath); process.exit(1); }
  if (node.unpacked) {
    // located in app.asar.unpacked/<ipath>
    console.error("unpacked file, at app.asar.unpacked dir");
    process.exit(2);
  }
  const buf = Buffer.alloc(node.size);
  readSync(fd, buf, 0, node.size, dataOffset + Number(node.offset));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  console.log(`extracted ${ipath} (${node.size} bytes) -> ${out}`);
} else if (cmd === "find") {
  // find <regex> — search file contents of files whose path matches rest[0] (or all .js under given dir), print matches
  const pathRe = new RegExp(rest[0]);
  const contentRe = new RegExp(rest[1]);
  for (const { path: p, node } of walk(header)) {
    if (!pathRe.test(p) || node.unpacked) continue;
    const buf = Buffer.alloc(node.size);
    readSync(fd, buf, 0, node.size, dataOffset + Number(node.offset));
    const text = buf.toString("utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (contentRe.test(lines[i])) {
        console.log(`${p}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
      }
    }
  }
}
closeSync(fd);
