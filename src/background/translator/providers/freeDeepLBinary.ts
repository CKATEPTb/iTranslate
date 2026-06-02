export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

// UINT8ARRAY UTILS

export function concatU8(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
}

export function fromBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// VARINT

function encodeVarint(value: number): Uint8Array {
    const parts: number[] = [];
    while (true) {
        const byte = value & 0x7f;
        value >>>= 7;
        if (value) parts.push(byte | 0x80);
        else { parts.push(byte); break; }
    }
    return new Uint8Array(parts);
}

export function decodeVarint(buf: Uint8Array, offset: number): [number, number] {
    let result = 0, shift = 0;
    while (offset < buf.length) {
        const b = buf[offset++];
        result |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
    }
    return [result, offset];
}

// MSGPACK FRAMING

export function msgpackPack(messages: Uint8Array[]): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const msg of messages) { parts.push(encodeVarint(msg.length)); parts.push(msg); }
    return concatU8(...parts);
}

export function msgpackUnpack(data: Uint8Array): Uint8Array[] {
    const messages: Uint8Array[] = [];
    const offsets = [0, 7, 14, 21, 28];
    let r = 0;
    while (r < data.length) {
        let size = 0, i = 0;
        while (true) {
            if (r + i >= data.length) throw new Error("Varint incomplete");
            const s = data[r + i];
            size |= (s & 0x7f) << offsets[i];
            i++;
            if ((s & 0x80) === 0 || i >= 5) break;
        }
        const start = r + i, end = start + size;
        if (end > data.length) throw new Error("Incomplete message");
        messages.push(data.slice(start, end));
        r = end;
    }
    return messages;
}

// MSGPACK ENCODE/DECODE

export class MsgExt {
    public type: number;

    public data: Uint8Array;

    constructor(type: number, data: Uint8Array) {
        this.data = data;
        this.type = type;
    }
}

export function mpEncode(value: any): Uint8Array {
    if (value === null || value === undefined) return new Uint8Array([0xc0]);
    if (value === true) return new Uint8Array([0xc3]);
    if (value === false) return new Uint8Array([0xc2]);

    if (value instanceof MsgExt) {
        const d = value.data, len = d.length;
        if (len === 1) return concatU8(new Uint8Array([0xd4, value.type]), d);
        if (len === 2) return concatU8(new Uint8Array([0xd5, value.type]), d);
        if (len === 4) return concatU8(new Uint8Array([0xd6, value.type]), d);
        if (len === 8) return concatU8(new Uint8Array([0xd7, value.type]), d);
        if (len === 16) return concatU8(new Uint8Array([0xd8, value.type]), d);
        if (len <= 0xff) return concatU8(new Uint8Array([0xc7, len, value.type]), d);
        if (len <= 0xffff) return concatU8(new Uint8Array([0xc8, (len >> 8) & 0xff, len & 0xff, value.type]), d);
        return concatU8(new Uint8Array([0xc9, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, value.type]), d);
    }

    if (value instanceof Uint8Array) {
        const len = value.length;
        if (len <= 0xff) return concatU8(new Uint8Array([0xc4, len]), value);
        if (len <= 0xffff) return concatU8(new Uint8Array([0xc5, (len >> 8) & 0xff, len & 0xff]), value);
        return concatU8(new Uint8Array([0xc6, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]), value);
    }

    if (typeof value === "number" && Number.isInteger(value)) {
        if (value >= 0 && value <= 0x7f) return new Uint8Array([value]);
        if (value < 0 && value >= -32) return new Uint8Array([0xe0 | (value + 32)]);
        if (value >= 0 && value <= 0xff) return new Uint8Array([0xcc, value]);
        if (value >= 0 && value <= 0xffff) return new Uint8Array([0xcd, (value >> 8) & 0xff, value & 0xff]);
        if (value >= 0 && value <= 0xffffffff) return new Uint8Array([0xce, (value >>> 24), (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
        if (value >= -128) return new Uint8Array([0xd0, value & 0xff]);
        if (value >= -32768) return new Uint8Array([0xd1, (value >> 8) & 0xff, value & 0xff]);
        return new Uint8Array([0xd2, (value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
    }

    if (typeof value === "string") {
        const bytes = encoder.encode(value), len = bytes.length;
        if (len <= 31) return concatU8(new Uint8Array([0xa0 | len]), bytes);
        if (len <= 0xff) return concatU8(new Uint8Array([0xd9, len]), bytes);
        if (len <= 0xffff) return concatU8(new Uint8Array([0xda, (len >> 8) & 0xff, len & 0xff]), bytes);
        return concatU8(new Uint8Array([0xdb, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]), bytes);
    }

    if (Array.isArray(value)) {
        const len = value.length;
        let header: Uint8Array;
        if (len <= 15) header = new Uint8Array([0x90 | len]);
        else if (len <= 0xffff) header = new Uint8Array([0xdc, (len >> 8) & 0xff, len & 0xff]);
        else header = new Uint8Array([0xdd, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
        return concatU8(header, ...value.map(mpEncode));
    }

    if (typeof value === "object") {
        const keys = Object.keys(value), len = keys.length;
        let header: Uint8Array;
        if (len <= 15) header = new Uint8Array([0x80 | len]);
        else if (len <= 0xffff) header = new Uint8Array([0xde, (len >> 8) & 0xff, len & 0xff]);
        else header = new Uint8Array([0xdf, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
        const parts: Uint8Array[] = [header];
        for (const k of keys) { parts.push(mpEncode(k)); parts.push(mpEncode(value[k])); }
        return concatU8(...parts);
    }

    return new Uint8Array([0xc0]);
}

export function mpDecode(buf: Uint8Array, offset = 0): [any, number] {
    const b = buf[offset++];
    if (b <= 0x7f) return [b, offset];
    if (b >= 0xe0) return [b - 256, offset];
    if ((b & 0xe0) === 0xa0) { const len = b & 0x1f; return [decoder.decode(buf.slice(offset, offset + len)), offset + len]; }
    if ((b & 0xf0) === 0x90) { const len = b & 0x0f; const arr: any[] = []; for (let i = 0; i < len; i++) { let v: any; [v, offset] = mpDecode(buf, offset); arr.push(v); } return [arr, offset]; }
    if ((b & 0xf0) === 0x80) { const len = b & 0x0f; const obj: any = {}; for (let i = 0; i < len; i++) { let k: any, v: any; [k, offset] = mpDecode(buf, offset); [v, offset] = mpDecode(buf, offset); obj[k] = v; } return [obj, offset]; }
    switch (b) {
        case 0xc0: return [null, offset];
        case 0xc2: return [false, offset];
        case 0xc3: return [true, offset];
        case 0xcc: return [buf[offset], offset + 1];
        case 0xcd: return [(buf[offset] << 8) | buf[offset + 1], offset + 2];
        case 0xce: return [((buf[offset] << 24) | (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3]) >>> 0, offset + 4];
        case 0xd0: return [buf[offset] - (buf[offset] & 0x80 ? 256 : 0), offset + 1];
        case 0xd1: { const v = (buf[offset] << 8) | buf[offset+1]; return [v >= 0x8000 ? v - 0x10000 : v, offset + 2]; }
        case 0xd2: return [(buf[offset] << 24) | (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3], offset + 4];
        case 0xd9: { const len = buf[offset++]; return [decoder.decode(buf.slice(offset, offset+len)), offset+len]; }
        case 0xda: { const len = (buf[offset] << 8)|buf[offset+1]; offset+=2; return [decoder.decode(buf.slice(offset, offset+len)), offset+len]; }
        case 0xc4: { const len = buf[offset++]; return [buf.slice(offset, offset+len), offset+len]; }
        case 0xc5: { const len = (buf[offset]<<8)|buf[offset+1]; offset+=2; return [buf.slice(offset, offset+len), offset+len]; }
        case 0xdc: { const len = (buf[offset]<<8)|buf[offset+1]; offset+=2; const arr: any[]=[]; for(let i=0;i<len;i++){let v:any;[v,offset]=mpDecode(buf,offset);arr.push(v);} return [arr,offset]; }
        case 0xdd: { const len = ((buf[offset]<<24)|(buf[offset+1]<<16)|(buf[offset+2]<<8)|buf[offset+3])>>>0; offset+=4; const arr:any[]=[]; for(let i=0;i<len;i++){let v:any;[v,offset]=mpDecode(buf,offset);arr.push(v);} return [arr,offset]; }
        case 0xde: { const len = (buf[offset]<<8)|buf[offset+1]; offset+=2; const obj:any={}; for(let i=0;i<len;i++){let k:any,v:any;[k,offset]=mpDecode(buf,offset);[v,offset]=mpDecode(buf,offset);obj[k]=v;} return [obj,offset]; }
        case 0xd4: { const type=buf[offset++]; return [new MsgExt(type, buf.slice(offset, offset+1)), offset+1]; }
        case 0xd5: { const type=buf[offset++]; return [new MsgExt(type, buf.slice(offset, offset+2)), offset+2]; }
        case 0xd6: { const type=buf[offset++]; return [new MsgExt(type, buf.slice(offset, offset+4)), offset+4]; }
        case 0xd7: { const type=buf[offset++]; return [new MsgExt(type, buf.slice(offset, offset+8)), offset+8]; }
        case 0xd8: { const type=buf[offset++]; return [new MsgExt(type, buf.slice(offset, offset+16)), offset+16]; }
        case 0xc7: { const len=buf[offset++]; const type=buf[offset++]; return [new MsgExt(type, buf.slice(offset, offset+len)), offset+len]; }
        case 0xc8: { const len=(buf[offset]<<8)|buf[offset+1]; offset+=2; const type=buf[offset++]; return [new MsgExt(type, buf.slice(offset, offset+len)), offset+len]; }
        case 0xc9: { const len=((buf[offset]<<24)|(buf[offset+1]<<16)|(buf[offset+2]<<8)|buf[offset+3])>>>0; offset+=4; const type=buf[offset++]; return [new MsgExt(type, buf.slice(offset, offset+len)), offset+len]; }
        default: return [null, offset];
    }
}
