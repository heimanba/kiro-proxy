// Minimal AWS EventStream framing (for test fixtures + decoding):
// message := totalLen(4) + headersLen(4) + preludeCrc(4) + headers + payload + messageCrc(4)
// CRC is CRC32 (IEEE). Header format: nameLen(1) + name + type(1) + value (string: len(2) + bytes)

type HeaderValue = string;
type HeaderMap = Record<string, HeaderValue>;
export type AwsEventStreamMessage = { headers: HeaderMap; payload: Uint8Array };

const te = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

function u16be(n: number) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, false);
  return b;
}

function encodeHeaders(headers: HeaderMap): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const nameBytes = te.encode(name);
    const valBytes = te.encode(value);
    parts.push(new Uint8Array([nameBytes.length]));
    parts.push(nameBytes);
    parts.push(new Uint8Array([7])); // string type
    parts.push(u16be(valBytes.length));
    parts.push(valBytes);
  }
  return concat(parts);
}

function concat(chunks: Uint8Array[]) {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function encodeAwsEventStreamMessage(msg: AwsEventStreamMessage): Uint8Array {
  const headersBytes = encodeHeaders(msg.headers);
  const totalLen = 4 + 4 + 4 + headersBytes.length + msg.payload.length + 4;
  const prelude = concat([u32be(totalLen), u32be(headersBytes.length)]);
  const preludeCrc = u32be(crc32(prelude));
  const withoutMsgCrc = concat([prelude, preludeCrc, headersBytes, msg.payload]);
  const msgCrc = u32be(crc32(withoutMsgCrc));
  return concat([withoutMsgCrc, msgCrc]);
}

export function decodeAwsEventStreamMessages(bytes: Uint8Array): AwsEventStreamMessage[] {
  const out: AwsEventStreamMessage[] = [];
  let off = 0;
  while (off + 16 <= bytes.length) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + off);
    const totalLen = dv.getUint32(0, false);
    const headersLen = dv.getUint32(4, false);
    if (off + totalLen > bytes.length) break; // need more bytes
    const msg = bytes.subarray(off, off + totalLen);
    // Validate CRCs (throws on mismatch so tests catch framing bugs)
    const prelude = msg.subarray(0, 8);
    const preludeCrc = new DataView(msg.buffer, msg.byteOffset + 8).getUint32(0, false);
    if (crc32(prelude) !== preludeCrc) throw new Error("bad prelude crc");
    const msgCrc = new DataView(msg.buffer, msg.byteOffset + totalLen - 4).getUint32(0, false);
    if (crc32(msg.subarray(0, totalLen - 4)) !== msgCrc) throw new Error("bad message crc");

    const headersStart = 12;
    const headersEnd = headersStart + headersLen;
    const payloadStart = headersEnd;
    const payloadEnd = totalLen - 4;
    const headers: HeaderMap = {};
    let hOff = headersStart;
    while (hOff < headersEnd) {
      const nameLen = msg[hOff]!;
      hOff += 1;
      const name = new TextDecoder().decode(msg.subarray(hOff, hOff + nameLen));
      hOff += nameLen;
      const type = msg[hOff]!;
      hOff += 1;
      if (type !== 7) throw new Error("unsupported header type");
      const valLen = new DataView(msg.buffer, msg.byteOffset + hOff).getUint16(0, false);
      hOff += 2;
      const value = new TextDecoder().decode(msg.subarray(hOff, hOff + valLen));
      hOff += valLen;
      headers[name] = value;
    }
    out.push({ headers, payload: msg.subarray(payloadStart, payloadEnd) });
    off += totalLen;
  }
  return out;
}
