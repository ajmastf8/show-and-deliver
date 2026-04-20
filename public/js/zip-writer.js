// Streaming STORE-only (ZIP64-aware) zip writer. Mirrors the PHP writer in
// index.php so archives produced here and there are byte-identical in layout
// — classic local-file-header + CD, no data descriptors, Unix 0100644 ext.
// attrs, DOS dates from file mtime. Strict readers like macOS Archive
// Utility accept this layout.
//
// Usage:
//   await zipToWriter({
//     entries: [{ name, url, mtime? }, ...],
//     write:   async (bytes) => { ... },           // receives Uint8Array chunks, in order
//     onProgress: (done, total, bytes) => { ... }, // optional
//     concurrency: 6,                               // optional, default 6
//   });
//
// Each entry's body is fetched via `fetch(entry.url)` and passed through to
// `write` together with its local file header. After all entries, the
// central directory and EOCD (and ZIP64 records when needed) are written.
// Fetches run in batches of `concurrency`; writes happen in fetch-completion
// order (ZIP has no mandated entry order).

(function (global) {
  'use strict';

  // --- CRC-32 (IEEE 802.3, reflected) --------------------------------------
  const CRC_TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_TABLE[i] = c >>> 0;
  }
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = (CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0;
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  // --- Little-endian writers -----------------------------------------------
  function u16(view, off, v) { view.setUint16(off, v, true); }
  function u32(view, off, v) { view.setUint32(off, v >>> 0, true); }
  function u64(view, off, v) {
    // JS bigint-free 64-bit LE write; v is a Number up to 2^53
    const lo = (v >>> 0);
    const hi = Math.floor(v / 0x100000000) >>> 0;
    view.setUint32(off, lo, true);
    view.setUint32(off + 4, hi, true);
  }

  function encodeUtf8(s) {
    return new TextEncoder().encode(s);
  }

  function dosTimeDate(epochMs) {
    const d = new Date(epochMs);
    const y = d.getFullYear();
    if (y < 1980) return { time: 0, date: 0x0021 };
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  const EXTERNAL_ATTRS_REGULAR_FILE = (0o100644 << 16) >>> 0;

  // Build a local file header (with file name bytes and optional ZIP64 extra)
  function buildLocalHeader({ nameBytes, size, crc, dosTime, dosDate, offset }) {
    const isZip64 = size >= 0xFFFFFFFF || offset >= 0xFFFFFFFF;
    const extraLen = isZip64 ? 20 : 0;
    const buf = new Uint8Array(30 + nameBytes.length + extraLen);
    const v = new DataView(buf.buffer);
    u32(v, 0,  0x04034b50);                       // signature
    u16(v, 4,  isZip64 ? 45 : 20);                // version needed
    u16(v, 6,  0x0000);                           // GP flag
    u16(v, 8,  0x0000);                           // method = STORE
    u16(v, 10, dosTime);
    u16(v, 12, dosDate);
    u32(v, 14, crc);
    u32(v, 18, isZip64 ? 0xFFFFFFFF : size);      // comp size
    u32(v, 22, isZip64 ? 0xFFFFFFFF : size);      // uncomp size
    u16(v, 26, nameBytes.length);
    u16(v, 28, extraLen);
    buf.set(nameBytes, 30);
    if (isZip64) {
      const eo = 30 + nameBytes.length;
      u16(v, eo,     0x0001);                     // ZIP64 ext. field ID
      u16(v, eo + 2, 16);                         // size of the ZIP64 extra data
      u64(v, eo + 4,  size);                      // uncomp size (8 bytes)
      u64(v, eo + 12, size);                      // comp size (8 bytes)
    }
    return { bytes: buf, isZip64 };
  }

  function buildCentralDirEntry(e) {
    const { nameBytes, size, crc, dosTime, dosDate, offset, isZip64 } = e;
    const cdExtraLen = isZip64 ? 28 : 0;
    const buf = new Uint8Array(46 + nameBytes.length + cdExtraLen);
    const v = new DataView(buf.buffer);
    u32(v, 0,  0x02014b50);                         // signature
    u16(v, 4,  0x031E);                             // version made by (Unix, 3.0)
    u16(v, 6,  isZip64 ? 45 : 20);                  // version needed
    u16(v, 8,  0x0000);                             // GP flag
    u16(v, 10, 0x0000);                             // method
    u16(v, 12, dosTime);
    u16(v, 14, dosDate);
    u32(v, 16, crc);
    u32(v, 20, isZip64 ? 0xFFFFFFFF : size);        // comp size
    u32(v, 24, isZip64 ? 0xFFFFFFFF : size);        // uncomp size
    u16(v, 28, nameBytes.length);
    u16(v, 30, cdExtraLen);
    u16(v, 32, 0);                                  // comment len
    u16(v, 34, 0);                                  // disk start
    u16(v, 36, 0);                                  // internal attrs
    u32(v, 38, EXTERNAL_ATTRS_REGULAR_FILE);
    u32(v, 42, isZip64 ? 0xFFFFFFFF : offset);
    buf.set(nameBytes, 46);
    if (isZip64) {
      const eo = 46 + nameBytes.length;
      u16(v, eo,     0x0001);
      u16(v, eo + 2, 24);
      u64(v, eo + 4,  size);
      u64(v, eo + 12, size);
      u64(v, eo + 20, offset);
    }
    return buf;
  }

  function buildEocd({ totalEntries, cdLen, cdOffset }) {
    const entries = totalEntries > 0xFFFF ? 0xFFFF : totalEntries;
    const size    = cdLen > 0xFFFFFFFF ? 0xFFFFFFFF : cdLen;
    const off     = cdOffset > 0xFFFFFFFF ? 0xFFFFFFFF : cdOffset;
    const buf = new Uint8Array(22);
    const v = new DataView(buf.buffer);
    u32(v, 0,  0x06054b50);
    u16(v, 4,  0); u16(v, 6,  0);
    u16(v, 8,  entries); u16(v, 10, entries);
    u32(v, 12, size); u32(v, 16, off);
    u16(v, 20, 0);
    return buf;
  }

  function buildZip64Tail({ totalEntries, cdLen, cdOffset }) {
    const buf = new Uint8Array(56 + 20);
    const v = new DataView(buf.buffer);
    // ZIP64 EOCD record
    u32(v, 0,  0x06064b50);
    u64(v, 4,  44);              // size of rec minus first 12 bytes
    u16(v, 12, 45); u16(v, 14, 45);
    u32(v, 16, 0);  u32(v, 20, 0);
    u64(v, 24, totalEntries);
    u64(v, 32, totalEntries);
    u64(v, 40, cdLen);
    u64(v, 48, cdOffset);
    // ZIP64 EOCD locator
    u32(v, 56, 0x07064b50);
    u32(v, 60, 0);
    u64(v, 64, cdOffset + cdLen);
    u32(v, 72, 1);
    return buf;
  }

  // Fetch a URL and stream the body through a ReadableStream reader. Chunks
  // are collected into an array (not concatenated) so there's no single
  // ArrayBuffer allocation — files can be larger than the ~2 GB per-alloc
  // cap Chrome enforces. CRC-32 is computed incrementally as bytes arrive,
  // so only the chunks themselves need to fit in memory (not double).
  async function fetchEntryChunks(url, signal, onBytes) {
    const resp = await fetch(url, { signal });
    if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
    if (!resp.body) {
      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (onBytes) onBytes(bytes.length);
      return { chunks: [bytes], size: bytes.length, crc: crc32(bytes) };
    }
    const reader = resp.body.getReader();
    const chunks = [];
    let size = 0;
    let crc = 0xffffffff;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      for (let i = 0; i < value.length; i++) {
        crc = (CRC_TABLE[(crc ^ value[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
      }
      if (onBytes) onBytes(value.length);
    }
    return { chunks, size, crc: (crc ^ 0xffffffff) >>> 0 };
  }

  // Orchestrate the download + zip build.
  //
  // Returns { size, skipped } where `skipped` is the list of entries that
  // couldn't be fetched (404s, network errors). A single bad file does NOT
  // abort the whole archive — the caller can surface the list afterward.
  //
  // `onProgress(done, total, bytes)` fires after each successful entry.
  // `onBytes(deltaBytes)` fires for every chunk as it streams in, so the
  // UI can tick during a single large file download.
  async function zipToWriter({ entries, write, onProgress, onBytes, concurrency = 6, signal }) {
    const records = [];
    const skipped = [];
    let offset = 0;
    let done = 0;
    let totalBytes = 0;

    const aborted = () => signal && signal.aborted;

    // Fetches run in parallel batches; writes serialize after each batch so
    // local-header offsets line up. ZIP has no mandated entry order.
    for (let i = 0; i < entries.length; i += concurrency) {
      if (aborted()) throw new DOMException('Aborted', 'AbortError');
      const batch = entries.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(async (entry) => {
        try {
          const got = await fetchEntryChunks(entry.url, signal, onBytes);
          return { entry, got };
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          return { entry, error: e };
        }
      }));
      for (const r of results) {
        if (r.error) {
          skipped.push({ name: r.entry.name, reason: r.error.message || String(r.error) });
          continue;
        }
        const { entry, got } = r;
        const { time, date } = dosTimeDate(entry.mtime || Date.now());
        const nameBytes = encodeUtf8(entry.name);
        const { bytes: header, isZip64 } = buildLocalHeader({
          nameBytes, size: got.size, crc: got.crc, dosTime: time, dosDate: date, offset,
        });
        await write(header);
        for (const chunk of got.chunks) {
          await write(chunk);
        }
        records.push({
          nameBytes, size: got.size, crc: got.crc, dosTime: time, dosDate: date,
          offset, isZip64,
        });
        offset += header.length + got.size;
        totalBytes += got.size;
        done++;
        if (onProgress) onProgress(done, entries.length, totalBytes);
      }
    }

    const cdOffset = offset;
    let cdLen = 0;
    for (const r of records) {
      const entry = buildCentralDirEntry(r);
      await write(entry);
      cdLen += entry.length;
    }

    const needZip64 = records.length > 0xFFFF || cdOffset >= 0xFFFFFFFF || cdLen >= 0xFFFFFFFF;
    if (needZip64) {
      await write(buildZip64Tail({ totalEntries: records.length, cdLen, cdOffset }));
    }
    await write(buildEocd({ totalEntries: records.length, cdLen, cdOffset }));

    return {
      size: cdOffset + cdLen + (needZip64 ? 76 : 0) + 22,
      skipped,
    };
  }

  global.ZipWriter = { zipToWriter };
})(window);
