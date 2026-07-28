function findEndOfCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("ไม่พบโครงสร้างไฟล์ XLSX");
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("เบราว์เซอร์นี้ยังไม่รองรับการเปิด XLSX กรุณาใช้ Chrome หรือ Edge รุ่นปัจจุบัน");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const end = findEndOfCentralDirectory(bytes);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map();

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("ไฟล์ XLSX เสียหาย");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + fileNameLength));

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("ไฟล์ XLSX เสียหาย");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) content = compressed;
    else if (method === 8) content = await inflateRaw(compressed);
    else throw new Error(`XLSX ใช้การบีบอัดที่ไม่รองรับ (${method})`);
    entries.set(name, content);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function parseXml(bytes) {
  if (!bytes) return null;
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (document.querySelector("parsererror")) throw new Error("อ่าน XML ในไฟล์ XLSX ไม่สำเร็จ");
  return document;
}

function columnIndex(reference) {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  return [...letters].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1;
}

function worksheetRows(document, sharedStrings) {
  const result = [];
  for (const rowNode of document.getElementsByTagName("row")) {
    const rowIndex = Math.max(0, Number(rowNode.getAttribute("r") || result.length + 1) - 1);
    const row = result[rowIndex] ?? [];
    for (const cell of rowNode.getElementsByTagName("c")) {
      const index = columnIndex(cell.getAttribute("r") || "A1");
      const type = cell.getAttribute("t");
      const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      let value = raw;
      if (type === "s") value = sharedStrings[Number(raw)] ?? "";
      else if (type === "inlineStr") value = cell.getElementsByTagName("is")[0]?.textContent ?? "";
      else if (type === "b") value = raw === "1";
      else if (raw !== "" && Number.isFinite(Number(raw))) value = Number(raw);
      row[index] = value;
    }
    result[rowIndex] = row;
  }
  return result.filter((row) => row?.some((value) => value !== "" && value != null));
}

async function readXlsx(file) {
  const entries = await unzipEntries(await file.arrayBuffer());
  const sharedDocument = parseXml(entries.get("xl/sharedStrings.xml"));
  const sharedStrings = sharedDocument
    ? [...sharedDocument.getElementsByTagName("si")].map((node) => node.textContent ?? "")
    : [];
  const sheetPath = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
  if (!sheetPath) throw new Error("ไม่พบ Worksheet ในไฟล์ XLSX");
  const sheetDocument = parseXml(entries.get(sheetPath));
  return worksheetRows(sheetDocument, sharedStrings);
}

function readCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_-]+/g, "");
}

function excelDate(value) {
  if (!value) return "";
  if (typeof value === "number" && value > 20_000 && value < 100_000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000).toISOString().slice(0, 10);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function rowsToItems(rows) {
  if (rows.length < 2) throw new Error("ไฟล์ไม่มีข้อมูลสำหรับนำเข้า");
  const headers = rows[0].map(normalizeHeader);
  const find = (...names) => {
    const normalized = names.map(normalizeHeader);
    return headers.findIndex((header) => normalized.includes(header));
  };
  const columns = {
    username: find("User name", "Username", "User", "ผู้ใช้", "ยูสเซอร์"),
    password: find("Pass Word", "Password", "Pass", "รหัสผ่าน"),
    previousPassword: find("Password Last", "Previous Password", "รหัสเดิม"),
    name: find("Platform", "System", "Service", "ระบบ", "ชื่อระบบ"),
    purpose: find("วัตถุประสงค์การใช้งาน", "Purpose"),
    owner: find("Owner", "เจ้าของ"),
    updatedAt: find("อัปเดตรหัสล่าสุด", "Updated", "Last Updated"),
    notes: find("หมายเหตุ", "Notes", "Note"),
    uri: find("ลิงค์", "Link", "URL", "URI", "Website"),
  };
  if (columns.name < 0 && columns.username < 0) {
    throw new Error("ไม่พบคอลัมน์ Platform หรือ User name");
  }
  return rows.slice(1).map((row) => {
    const get = (column) => column >= 0 ? String(row[column] ?? "").trim() : "";
    return {
      type: "login",
      name: get(columns.name) || get(columns.username) || "Imported Login",
      username: get(columns.username),
      password: get(columns.password),
      previousPassword: get(columns.previousPassword),
      uri: get(columns.uri),
      purpose: get(columns.purpose),
      owner: get(columns.owner),
      notes: get(columns.notes),
      passwordUpdatedAt: excelDate(columns.updatedAt >= 0 ? row[columns.updatedAt] : ""),
    };
  }).filter((item) => item.name || item.username || item.password);
}

export async function readCredentialFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  let rows;
  if (extension === "xlsx") rows = await readXlsx(file);
  else if (extension === "csv") rows = readCsv(await file.text());
  else if (extension === "json") {
    const parsed = JSON.parse(await file.text());
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.items)) return parsed.items;
    throw new Error("JSON ต้องมีรายการใน items");
  } else throw new Error("รองรับไฟล์ .xlsx, .csv และ .json เท่านั้น");
  return rowsToItems(rows);
}
