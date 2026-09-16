const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_ENTRIES = 1000;
const MAX_ENTRY_SIZE = 128 * 1024 * 1024;
const MAX_TOTAL_ENTRY_SIZE = 128 * 1024 * 1024;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const writeUint16 = (view, offset, value) => view.setUint16(offset, value, true);
const writeUint32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);

const dosTimestamp = () => {
  const now = new Date();
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  return { date, time };
};

const concatenate = (parts, length) => {
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

export const createZip = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ENTRIES) {
    throw new Error("A Vibe Up archive must contain between one and 1,000 files.");
  }

  const localParts = [];
  const centralParts = [];
  let localLength = 0;
  let centralLength = 0;
  const { date, time } = dosTimestamp();

  for (const entry of entries) {
    if (typeof entry.name !== "string" || entry.name.length === 0 || entry.name.includes("..") || entry.name.startsWith("/")) {
      throw new Error("The archive contains an invalid file name.");
    }

    const name = textEncoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    if (data.length > MAX_ENTRY_SIZE) {
      throw new Error(`Archive entry ${entry.name} is too large.`);
    }

    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, time);
    writeUint16(localView, 12, date);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, name.length);
    writeUint16(localView, 28, 0);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, time);
    writeUint16(centralView, 14, date);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, data.length);
    writeUint32(centralView, 24, data.length);
    writeUint16(centralView, 28, name.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localLength);
    central.set(name, 46);
    centralParts.push(central);

    localLength += local.length;
    centralLength += central.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralLength);
  writeUint32(endView, 16, localLength);
  writeUint16(endView, 20, 0);
  return concatenate([...localParts, ...centralParts, end], localLength + centralLength + end.length);
};

const readUint16 = (view, offset) => view.getUint16(offset, true);
const readUint32 = (view, offset) => view.getUint32(offset, true);

const locateEndOfCentralDirectory = (bytes) => {
  const minimum = Math.max(0, bytes.length - 65557);
  for (let index = bytes.length - 22; index >= minimum; index -= 1) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06) {
      return index;
    }
  }
  return -1;
};

const inflate = async (compressed) => {
  if (!("DecompressionStream" in globalThis)) {
    throw new Error("This browser cannot open compressed .vibeup archives. Use the current Chromium release.");
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > MAX_ENTRY_SIZE) {
        await reader.cancel();
        throw new Error("The compressed ZIP entry exceeds the uncompressed size limit.");
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed after a decompression failure.
    }
    throw error;
  }
  return concatenate(chunks, length);
};

export const readZip = async (buffer) => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 22) {
    throw new Error("The file is not a valid ZIP archive.");
  }

  const endOffset = locateEndOfCentralDirectory(bytes);
  if (endOffset < 0) {
    throw new Error("The ZIP central directory could not be found.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const disk = readUint16(view, endOffset + 4);
  const centralDisk = readUint16(view, endOffset + 6);
  const entryCount = readUint16(view, endOffset + 10);
  const centralSize = readUint32(view, endOffset + 12);
  const centralOffset = readUint32(view, endOffset + 16);
  const totalUncompressedLimit = MAX_TOTAL_ENTRY_SIZE;
  let totalUncompressedSize = 0;
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entryCount === 0 ||
    entryCount > MAX_ENTRIES ||
    centralOffset + centralSize > bytes.length ||
    centralOffset + centralSize > endOffset
  ) {
    throw new Error("This ZIP archive uses an unsupported layout.");
  }

  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || readUint32(view, offset) !== 0x02014b50) {
      throw new Error("The ZIP central directory is malformed.");
    }
    const compression = readUint16(view, offset + 10);
    const checksum = readUint32(view, offset + 16);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const nameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localOffset = readUint32(view, offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (offset + recordLength > bytes.length || uncompressedSize > MAX_ENTRY_SIZE || compressedSize > MAX_ENTRY_SIZE) {
      throw new Error("The ZIP archive contains an oversized or malformed entry.");
    }
    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > totalUncompressedLimit) {
      throw new Error("The ZIP archive exceeds the total uncompressed size limit.");
    }
    const name = textDecoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (name.includes("..") || name.startsWith("/") || entries.has(name)) {
      throw new Error("The ZIP archive contains an unsafe or duplicate entry name.");
    }
    if (localOffset + 30 > bytes.length || readUint32(view, localOffset) !== 0x04034b50) {
      throw new Error("The ZIP archive has an invalid local file header.");
    }
    const localNameLength = readUint16(view, localOffset + 26);
    const localExtraLength = readUint16(view, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.length || localNameLength !== nameLength) {
      throw new Error("The ZIP archive is truncated.");
    }
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
    let data;
    if (compression === 0) {
      data = compressed;
    } else if (compression === 8) {
      data = await inflate(compressed);
    } else {
      throw new Error("The .vibeup archive uses an unsupported ZIP compression method.");
    }
    if (data.length !== uncompressedSize || crc32(data) !== checksum) {
      throw new Error(`The archive entry ${name} is corrupt.`);
    }
    entries.set(name, data);
    offset += recordLength;
  }
  return entries;
};

export const encodeJson = (data) => textEncoder.encode(JSON.stringify(data, null, 2));
export const decodeJson = (bytes) => JSON.parse(textDecoder.decode(bytes));
