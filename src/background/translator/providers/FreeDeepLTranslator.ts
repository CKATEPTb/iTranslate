const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ─────────────────────────────────────────────
// UINT8ARRAY UTILS
// ─────────────────────────────────────────────

function concatU8(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
}

function fromBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// ─────────────────────────────────────────────
// VARINT
// ─────────────────────────────────────────────

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

function decodeVarint(buf: Uint8Array, offset: number): [number, number] {
    let result = 0, shift = 0;
    while (offset < buf.length) {
        const b = buf[offset++];
        result |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
    }
    return [result, offset];
}

// ─────────────────────────────────────────────
// MSGPACK FRAMING
// ─────────────────────────────────────────────

function msgpackPack(messages: Uint8Array[]): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const msg of messages) { parts.push(encodeVarint(msg.length)); parts.push(msg); }
    return concatU8(...parts);
}

function msgpackUnpack(data: Uint8Array): Uint8Array[] {
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

// ─────────────────────────────────────────────
// MSGPACK ENCODE/DECODE
// ─────────────────────────────────────────────

class MsgExt {
    public type: number;

    public data: Uint8Array;

    constructor(type: number, data: Uint8Array) {
        this.data = data;
        this.type = type;
    }
}

function mpEncode(value: any): Uint8Array {
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

function mpDecode(buf: Uint8Array, offset = 0): [any, number] {
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

let PROTO_DEF: Record<string, any> = {
    "deepl.pb.interactive_text_api.common.alternatives.TextUnitAlternativesFlowId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.common.alternatives.TextUnitAlternativeDiff": {
        "1": {
            "name": "sourceRange",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.TextRange"
        },
        "2": {
            "name": "alternativeRange",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.TextRange"
        }
    },
    "deepl.pb.interactive_text_api.common.alternatives.RequestTextUnitAlternativesAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.TextUnitAlternativesFlowId"
        }
    },
    "google.protobuf.Timestamp": {
        "1": {
            "name": "seconds",
            "type": "int"
        },
        "2": {
            "name": "nanos",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.common.alternatives.SelectWordAlternativeAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.WordAlternativesFlowId"
        },
        "2": {
            "name": "selection",
            "type": "string"
        }
    },
    "google.protobuf.Int32Value": {
        "1": {
            "name": "value",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.AnnotationId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.common.translation_memories.TranslationMemoryAnnotationPayload": {
        "1": {
            "name": "id",
            "type": "string"
        },
        "2": {
            "name": "sourceText",
            "type": "string"
        },
        "3": {
            "seen_repeated": true,
            "name": "matches",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.translation_memories.TranslationMemoryMatch"
        }
    },
    "deepl.pb.interactive_text_api.common.translation_memories.TranslationMemoryMatch": {
        "1": {
            "name": "matchedText",
            "type": "string"
        },
        "2": {
            "name": "translation",
            "type": "string"
        },
        "3": {
            "name": "score",
            "type": "float"
        }
    },
    "deepl.pb.interactive_text_api.common.translation_memories.TranslationMemoryId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "google.protobuf.Duration": {
        "1": {
            "name": "seconds",
            "type": "int"
        },
        "2": {
            "name": "nanos",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.write.DiffUnitAnnotationPayload": {
        "1": {
            "name": "diffUnitId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.DiffUnitId"
        }
    },
    "deepl.pb.interactive_text_api.write.ProvidedTextUnitAlternativesAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.TextUnitAlternativesFlowId"
        },
        "2": {
            "seen_repeated": true,
            "name": "alternatives",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.TextUnitAlternative"
        }
    },
    "deepl.pb.interactive_text_api.write.ProvidedAutomaticTextUnitAlternativesAnnotationPayload": {
        "1": {
            "seen_repeated": true,
            "name": "alternatives",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.TextUnitAlternative"
        }
    },
    "deepl.pb.interactive_text_api.write.LanguagesPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "languages",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.Language"
        }
    },
    "deepl.pb.interactive_text_api.write.GlossaryLanguagesPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "languages",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.Language"
        }
    },
    "deepl.pb.interactive_text_api.write.RequestedLanguagePropertyValue": {
        "1": {
            "name": "language",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.Language"
        }
    },
    "deepl.pb.interactive_text_api.write.CalculatedLanguagePropertyValue": {
        "1": {
            "name": "language",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.Language"
        },
        "2": {
            "name": "origin",
            "type": "int"
        },
        "3": {
            "name": "isLanguageDetectionConfident",
            "type": "uint"
        }
    },
    "deepl.pb.interactive_text_api.write.GlossaryIdPropertyValue": {
        "1": {
            "name": "glossaryId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.glossaries.GlossaryId"
        }
    },
    "deepl.pb.interactive_text_api.write.StyleGuideIdPropertyValue": {
        "1": {
            "name": "styleGuideId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.styleguides.StyleGuideId"
        }
    },
    "deepl.pb.interactive_text_api.write.CorrectionsOnlyPropertyValue": {
        "1": {
            "name": "correctionsOnly",
            "type": "uint"
        }
    },
    "deepl.pb.interactive_text_api.write.FreeTextPromptListPropertyValue": {
        "1": {
            "name": "freeTextPromptList",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.free_text_prompts.FreeTextPromptList"
        }
    },
    "deepl.pb.interactive_text_api.write.MaximumTextLengthPropertyValue": {
        "1": {
            "name": "max",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.write.StyleVariantsPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "styleVariants",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.StyleVariant"
        }
    },
    "deepl.pb.interactive_text_api.write.StyleVariantPropertyValue": {
        "1": {
            "name": "styleVariant",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.StyleVariant"
        }
    },
    "deepl.pb.interactive_text_api.write.UnsupportedLanguagePropertyValue": {},
    "deepl.pb.interactive_text_api.write.InlineSuggestionsLoadingPropertyValue": {},
    "deepl.pb.interactive_text_api.write.DiffUnitId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.GlossaryEntry": {
        "1": {
            "name": "term",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.GlossaryListPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "glossaryEntries",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.GlossaryEntry"
        }
    },
    "deepl.pb.interactive_text_api.write.GlossarySupportPropertyValue": {},
    "deepl.pb.interactive_text_api.write.StyleGuideSupportPropertyValue": {},
    "deepl.pb.interactive_text_api.write.CorrectionsOnlySupportPropertyValue": {},
    "deepl.pb.interactive_text_api.write.TextUnitAlternativesSupportPropertyValue": {},
    "deepl.pb.interactive_text_api.write.GlossaryHighlight": {
        "1": {
            "name": "entry",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.GlossaryEntry"
        },
        "2": {
            "seen_repeated": true,
            "name": "ranges",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.TextRange"
        }
    },
    "deepl.pb.interactive_text_api.write.Language": {
        "1": {
            "name": "code",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.TextUnitAlternative": {
        "1": {
            "name": "text",
            "type": "string"
        },
        "2": {
            "seen_repeated": true,
            "name": "glossaryHighlights",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.GlossaryHighlight"
        },
        "3": {
            "seen_repeated": true,
            "name": "diffs",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.TextUnitAlternativeDiff"
        },
        "4": {
            "name": "rephraseVariant",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.RephraseVariant"
        },
        "5": {
            "seen_repeated": true,
            "name": "customRuleHighlights",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.styleguides.CustomRuleHighlight"
        }
    },
    "deepl.pb.interactive_text_api.write.RephraseVariant": {
        "1": {
            "name": "name",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.StyleVariant": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.ChangeStyleAlternativesFlowId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.RequestChangeStyleAlternativesAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.ChangeStyleAlternativesFlowId"
        },
        "2": {
            "name": "styleVariant",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.StyleVariant"
        }
    },
    "deepl.pb.interactive_text_api.write.ChangeStyleAlternative": {
        "1": {
            "name": "text",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.ProvidedChangeStyleAlternativesAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.ChangeStyleAlternativesFlowId"
        },
        "2": {
            "seen_repeated": true,
            "name": "alternatives",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.ChangeStyleAlternative"
        }
    },
    "deepl.pb.interactive_text_api.write.SelectChangeStyleAlternativeAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.ChangeStyleAlternativesFlowId"
        },
        "2": {
            "name": "selection",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.TemplateAdaptationTemplateId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.TemplateAdaptationTemplatesPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "templateIds",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.TemplateAdaptationTemplateId"
        }
    },
    "deepl.pb.interactive_text_api.write.TemplateAdaptationFlowId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.RequestTemplateAdaptationAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.TemplateAdaptationFlowId"
        },
        "2": {
            "name": "input",
            "type": "string"
        },
        "3": {
            "seen_repeated": true,
            "name": "templateIds",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.TemplateAdaptationTemplateId"
        }
    },
    "deepl.pb.interactive_text_api.write.TemplateAdaptationAdaptedText": {
        "1": {
            "name": "text",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.ProvidedTemplateAdaptationAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.TemplateAdaptationFlowId"
        },
        "2": {
            "name": "adaptedText",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.TemplateAdaptationAdaptedText"
        }
    },
    "deepl.pb.interactive_text_api.write.InlineSuggestionId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.InlineSuggestionAnnotationPayload": {
        "1": {
            "name": "id",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.InlineSuggestionId"
        },
        "2": {
            "seen_repeated": true,
            "name": "categories",
            "type": "int"
        },
        "3": {
            "name": "description",
            "type": "string"
        },
        "4": {
            "name": "userChoice",
            "type": "int"
        },
        "5": {
            "seen_repeated": true,
            "name": "originalSpans",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.TextRange"
        }
    },
    "deepl.pb.interactive_text_api.write.InlineSuggestionSpanAnnotationPayload": {
        "1": {
            "name": "id",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.InlineSuggestionId"
        }
    },
    "deepl.pb.interactive_text_api.write.ActOnInlineSuggestionAnnotationPayload": {
        "1": {
            "name": "inlineSuggestionId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.InlineSuggestionId"
        },
        "2": {
            "name": "userChoice",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.write.InlineSuggestionsTextUnitStateAnnotationPayload": {
        "1": {
            "name": "textUnitId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.text_units.TextUnitId"
        },
        "2": {
            "seen_repeated": true,
            "name": "inlineSuggestionIds",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.InlineSuggestionId"
        },
        "3": {
            "name": "originalText",
            "type": "string"
        },
        "4": {
            "name": "improvedText",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.write.RequestInlineSuggestionImprovedTextAnnotationPayload": {
        "1": {
            "name": "inlineSuggestionId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.InlineSuggestionId"
        }
    },
    "deepl.pb.interactive_text_api.write.ProvidedInlineSuggestionImprovedTextAnnotationPayload": {
        "1": {
            "name": "inlineSuggestionId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.InlineSuggestionId"
        },
        "2": {
            "name": "improvedText",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.common.alternatives.WordAlternative": {
        "1": {
            "name": "text",
            "type": "string"
        },
        "2": {
            "seen_repeated": true,
            "name": "targetHighlights",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.AnnotationId"
        }
    },
    "deepl.pb.interactive_text_api.common.alternatives.ProvidedWordAlternativesAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.WordAlternativesFlowId"
        },
        "2": {
            "seen_repeated": true,
            "name": "alternatives",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.WordAlternative"
        }
    },
    "deepl.pb.interactive_text_api.common.text_formatting.TextFormattingId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.common.styleguides.StyleGuideId": {
        "1": {
            "name": "id",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.common.alternatives.RequestWordAlternativesAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.WordAlternativesFlowId"
        }
    },
    "deepl.pb.interactive_text_api.common.text_formatting.TextFormattingAnnotationPayload": {
        "1": {
            "name": "textFormattingId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.text_formatting.TextFormattingId"
        },
        "2": {
            "name": "name",
            "type": "string"
        },
        "3": {
            "seen_repeated": true,
            "name": "children",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.text_formatting.TextFormattingId"
        },
        "4": {
            "seen_repeated": true,
            "name": "attributes",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.text_formatting.TextFormattingAnnotationPayload.AttributesEntry"
        }
    },
    "deepl.pb.interactive_text_api.common.text_formatting.TextFormattingAnnotationPayload.AttributesEntry": {
        "1": {
            "name": "key",
            "type": "string"
        },
        "2": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.common.glossaries.GlossaryId": {
        "1": {
            "name": "id",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.common.styleguides.CustomRuleHighlight": {
        "1": {
            "name": "id",
            "type": "string"
        },
        "2": {
            "name": "isFreeTextRule",
            "type": "uint"
        },
        "3": {
            "name": "kind",
            "type": "int"
        },
        "4": {
            "seen_repeated": true,
            "name": "ranges",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.TextRange"
        },
        "5": {
            "seen_repeated": true,
            "name": "originalRanges",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.TextRange"
        },
        "6": {
            "name": "description",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.common.styleguides.CustomRuleAnnotationPayload": {
        "1": {
            "name": "id",
            "type": "string"
        },
        "2": {
            "name": "isFreeTextRule",
            "type": "uint"
        },
        "3": {
            "name": "kind",
            "type": "int"
        },
        "6": {
            "name": "description",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.common.alternatives.SelectAutomaticTextUnitAlternativeAnnotationPayload": {
        "1": {
            "name": "selection",
            "type": "string"
        },
        "2": {
            "name": "rephraseVariant",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.RephraseVariant"
        }
    },
    "deepl.pb.interactive_text_api.common.translation_memories.TranslationMemory": {
        "1": {
            "name": "id",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.translation_memories.TranslationMemoryId"
        },
        "2": {
            "name": "name",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.RequestAutocompletionAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.AutocompletionFlowId"
        }
    },
    "deepl.pb.interactive_text_api.translator.ProvidedAutocompletionAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.AutocompletionFlowId"
        },
        "2": {
            "seen_repeated": true,
            "name": "autocompletions",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TextUnitAlternative"
        }
    },
    "deepl.pb.interactive_text_api.translator.SelectAutocompletionAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.AutocompletionFlowId"
        },
        "2": {
            "name": "selection",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.GlossaryReplacementAnnotationPayload": {
        "1": {
            "name": "replacement",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.GlossaryEntry"
        }
    },
    "deepl.pb.interactive_text_api.translator.ProvidedTextUnitAlternativesAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.TextUnitAlternativesFlowId"
        },
        "2": {
            "seen_repeated": true,
            "name": "alternatives",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TextUnitAlternative"
        }
    },
    "deepl.pb.interactive_text_api.translator.ProvidedAutomaticTextUnitAlternativesAnnotationPayload": {
        "1": {
            "seen_repeated": true,
            "name": "alternatives",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TextUnitAlternative"
        }
    },
    "deepl.pb.interactive_text_api.translator.RequestClarifyAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyFlowId"
        }
    },
    "deepl.pb.interactive_text_api.translator.ClarifyStatusAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyFlowId"
        },
        "2": {
            "name": "referenceId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.AnnotationId"
        },
        "3": {
            "name": "status",
            "type": "int"
        },
        "4": {
            "name": "errorInfo",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyErrorInfo"
        }
    },
    "deepl.pb.interactive_text_api.translator.ProvidedClarifyHighlightAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyFlowId"
        },
        "2": {
            "name": "questionId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyQuestionId"
        }
    },
    "deepl.pb.interactive_text_api.translator.ProvidedClarifyQuestionAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyFlowId"
        },
        "2": {
            "name": "questionWithAnswers",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyQuestionWithAnswers"
        }
    },
    "deepl.pb.interactive_text_api.translator.SelectClarifyAnswerAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyFlowId"
        },
        "2": {
            "name": "questionId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyQuestionId"
        },
        "3": {
            "name": "answer",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifySelectedAnswer"
        }
    },
    "deepl.pb.interactive_text_api.translator.RequestRephraseTargetTextAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.SourceLanguagesPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "sourceLanguages",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SourceLanguage"
        }
    },
    "deepl.pb.interactive_text_api.translator.TargetLanguagesPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "targetLanguages",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TargetLanguage"
        }
    },
    "deepl.pb.interactive_text_api.translator.RequestedSourceLanguagePropertyValue": {
        "1": {
            "name": "sourceLanguage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SourceLanguage"
        }
    },
    "deepl.pb.interactive_text_api.translator.CalculatedSourceLanguagePropertyValue": {
        "1": {
            "name": "sourceLanguage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SourceLanguage"
        },
        "2": {
            "name": "origin",
            "type": "int"
        },
        "3": {
            "name": "isLanguageDetectionConfident",
            "type": "uint"
        }
    },
    "deepl.pb.interactive_text_api.translator.RequestedTargetLanguagePropertyValue": {
        "1": {
            "name": "targetLanguage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TargetLanguage"
        }
    },
    "deepl.pb.interactive_text_api.translator.CalculatedTargetLanguagePropertyValue": {
        "1": {
            "name": "targetLanguage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TargetLanguage"
        }
    },
    "deepl.pb.interactive_text_api.translator.GlossaryIdPropertyValue": {
        "1": {
            "name": "glossaryId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.glossaries.GlossaryId"
        }
    },
    "deepl.pb.interactive_text_api.translator.StyleGuideIdPropertyValue": {
        "1": {
            "name": "styleGuideId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.styleguides.StyleGuideId"
        }
    },
    "deepl.pb.interactive_text_api.translator.InterfaceLanguagePropertyValue": {
        "1": {
            "name": "interfaceLanguage",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.FreeTextPromptListPropertyValue": {
        "1": {
            "name": "freeTextPromptList",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.free_text_prompts.FreeTextPromptList"
        }
    },
    "deepl.pb.interactive_text_api.translator.GlossarySupportPropertyValue": {},
    "deepl.pb.interactive_text_api.translator.StyleGuideSupportPropertyValue": {},
    "deepl.pb.interactive_text_api.translator.RtfSupportPropertyValue": {},
    "deepl.pb.interactive_text_api.translator.TaskMetaInfo": {
        "1": {
            "name": "progressInPercent",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.translator.FormalityModesPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "formalityModes",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.FormalityMode"
        }
    },
    "deepl.pb.interactive_text_api.translator.FormalityModePropertyValue": {
        "1": {
            "name": "formalityMode",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.FormalityMode"
        }
    },
    "deepl.pb.interactive_text_api.translator.LanguageModelsPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "languageModels",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.LanguageModel"
        }
    },
    "deepl.pb.interactive_text_api.translator.LanguageModelPropertyValue": {
        "1": {
            "name": "languageModel",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.LanguageModel"
        }
    },
    "deepl.pb.interactive_text_api.translator.TextDirectionPropertyValue": {
        "1": {
            "name": "textDirection",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.translator.MaximumTextLengthPropertyValue": {
        "1": {
            "name": "max",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.translator.UnsupportedSourceLanguagePropertyValue": {},
    "deepl.pb.interactive_text_api.translator.SourceLanguageDetectionWeightsPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "weights",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SourceLanguageDetectionWeight"
        }
    },
    "deepl.pb.interactive_text_api.translator.StyleVariantsPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "styleVariants",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.StyleVariant"
        }
    },
    "deepl.pb.interactive_text_api.translator.StyleVariantPropertyValue": {
        "1": {
            "name": "styleVariant",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.StyleVariant"
        }
    },
    "deepl.pb.interactive_text_api.translator.TranslationMemoryListPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "translationMemories",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.translation_memories.TranslationMemory"
        }
    },
    "deepl.pb.interactive_text_api.translator.SelectedTranslationMemoryPropertyValue": {
        "1": {
            "name": "translationMemoryId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.translation_memories.TranslationMemoryId"
        },
        "2": {
            "name": "threshold",
            "type": "float"
        }
    },
    "deepl.pb.interactive_text_api.translator.RephraseTargetTextStatusPropertyValue": {
        "1": {
            "name": "rephraseTargetTextStatus",
            "type": "int"
        },
        "2": {
            "name": "flowId",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.SessionOptions": {
        "1": {
            "name": "enableTranscription",
            "type": "uint"
        },
        "2": {
            "name": "enableTranslatorQuoteConversion",
            "type": "uint"
        },
        "3": {
            "name": "disableLanguageWeights",
            "type": "uint"
        },
        "4": {
            "name": "doNotOverrideRequestedSourceLanguage",
            "type": "uint"
        },
        "5": {
            "name": "enableInlineSuggestions",
            "type": "uint"
        },
        "6": {
            "name": "usageType",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.translator.FormalityMode": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.LanguageModel": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.LanguageModelPreference": {
        "1": {
            "name": "sourceLanguage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SourceLanguage"
        },
        "2": {
            "name": "targetLanguage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TargetLanguage"
        },
        "3": {
            "name": "model",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.LanguageModel"
        }
    },
    "deepl.pb.interactive_text_api.translator.LanguageModelPreferencesPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "preferences",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.LanguageModelPreference"
        }
    },
    "deepl.pb.interactive_text_api.translator.GlossaryEntry": {
        "1": {
            "name": "source",
            "type": "string"
        },
        "2": {
            "name": "target",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.GlossaryListPropertyValue": {
        "1": {
            "seen_repeated": true,
            "name": "glossaryEntries",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.GlossaryEntry"
        }
    },
    "deepl.pb.interactive_text_api.translator.GlossaryHighlight": {
        "1": {
            "name": "entry",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.GlossaryEntry"
        },
        "2": {
            "seen_repeated": true,
            "name": "ranges",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.TextRange"
        }
    },
    "deepl.pb.interactive_text_api.translator.SourceLanguage": {
        "1": {
            "name": "code",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.TargetLanguage": {
        "1": {
            "name": "code",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.TextUnitAlternative": {
        "1": {
            "name": "text",
            "type": "string"
        },
        "2": {
            "seen_repeated": true,
            "name": "glossaryHighlights",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.GlossaryHighlight"
        },
        "3": {
            "name": "transcription",
            "type": "string"
        },
        "4": {
            "seen_repeated": true,
            "name": "diffs",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.TextUnitAlternativeDiff"
        },
        "5": {
            "seen_repeated": true,
            "name": "customRuleHighlights",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.styleguides.CustomRuleHighlight"
        }
    },
    "deepl.pb.interactive_text_api.translator.SourceLanguageDetectionWeight": {
        "1": {
            "name": "language",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SourceLanguage"
        },
        "2": {
            "name": "weight",
            "type": "double"
        }
    },
    "deepl.pb.interactive_text_api.translator.ClarifyQuestion": {
        "1": {
            "name": "id",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyQuestionId"
        },
        "2": {
            "name": "title",
            "type": "string"
        },
        "3": {
            "name": "question",
            "type": "string"
        },
        "4": {
            "name": "category",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.ClarifyAnswer": {
        "1": {
            "name": "answer",
            "type": "string"
        },
        "2": {
            "name": "isDefault",
            "type": "uint"
        },
        "3": {
            "name": "hint",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.ClarifyQuestionWithAnswers": {
        "1": {
            "name": "question",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyQuestion"
        },
        "2": {
            "seen_repeated": true,
            "name": "answers",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyAnswer"
        },
        "3": {
            "name": "language",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.ClarifySelectedAnswer": {
        "1": {
            "name": "answer",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.ClarifyFlowId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.ClarifyQuestionId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.ClarifyErrorInfo": {
        "1": {
            "name": "errorCode",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.StyleVariant": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.common.alternatives.AutocompletionFlowId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.signalr.DetailCode": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.signalr.ClientErrorInfo": {
        "1": {
            "name": "statusCode",
            "type": "int"
        },
        "2": {
            "name": "detailCode",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.signalr.DetailCode"
        },
        "3": {
            "seen_repeated": true,
            "name": "fallbackDetailCodes",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.signalr.DetailCode"
        }
    },
    "deepl.pb.interactive_text_api.common.text_units.TextUnitAnnotationPayload": {
        "1": {
            "name": "textUnitId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.text_units.TextUnitId"
        },
        "2": {
            "name": "isUserEdited",
            "type": "uint"
        }
    },
    "deepl.pb.interactive_text_api.common.alternatives.ProvidedWordAlternativeHighlightPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.WordAlternativesFlowId"
        }
    },
    "deepl.pb.interactive_text_api.common.free_text_prompts.FreeTextPromptList": {
        "1": {
            "seen_repeated": true,
            "name": "prompts",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.TextRange": {
        "1": {
            "name": "start",
            "type": "int"
        },
        "2": {
            "name": "end",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.common.alternatives.SelectTextUnitAlternativeAnnotationPayload": {
        "1": {
            "name": "flowId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.TextUnitAlternativesFlowId"
        },
        "2": {
            "name": "selection",
            "type": "string"
        },
        "3": {
            "name": "rephraseVariant",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.RephraseVariant"
        }
    },
    "deepl.pb.interactive_text_api.common.alternatives.WordAlternativesFlowId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.common.text_units.TextUnitId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.TextChangeOperation": {
        "1": {
            "name": "range",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.TextRange"
        },
        "2": {
            "name": "text",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.CreateAnnotationOperation": {
        "1": {
            "name": "annotationId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.AnnotationId"
        },
        "2": {
            "name": "range",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.TextRange"
        },
        "3": {
            "name": "textUnitPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.text_units.TextUnitAnnotationPayload"
        },
        "4": {
            "name": "requestWordAlternativesPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.RequestWordAlternativesAnnotationPayload"
        },
        "5": {
            "name": "providedWordAlternativesPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.ProvidedWordAlternativesAnnotationPayload"
        },
        "6": {
            "name": "selectWordAlternativePayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.SelectWordAlternativeAnnotationPayload"
        },
        "7": {
            "name": "translatorGlossaryReplacementPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.GlossaryReplacementAnnotationPayload"
        },
        "8": {
            "name": "requestTextUnitAlternativesPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.RequestTextUnitAlternativesAnnotationPayload"
        },
        "9": {
            "name": "translatorProvidedTextUnitAlternativesPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ProvidedTextUnitAlternativesAnnotationPayload"
        },
        "10": {
            "name": "selectTextUnitAlternativePayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.SelectTextUnitAlternativeAnnotationPayload"
        },
        "11": {
            "name": "translatorRequestAutocompletionPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.RequestAutocompletionAnnotationPayload"
        },
        "12": {
            "name": "translatorProvidedAutocompletionPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ProvidedAutocompletionAnnotationPayload"
        },
        "13": {
            "name": "translatorSelectAutocompletionPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SelectAutocompletionAnnotationPayload"
        },
        "14": {
            "name": "translatorProvidedAutomaticTextUnitAlternativesPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ProvidedAutomaticTextUnitAlternativesAnnotationPayload"
        },
        "15": {
            "name": "selectAutomaticTextUnitAlternativePayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.SelectAutomaticTextUnitAlternativeAnnotationPayload"
        },
        "16": {
            "name": "writeDiffUnitPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.DiffUnitAnnotationPayload"
        },
        "17": {
            "name": "textFormattingPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.text_formatting.TextFormattingAnnotationPayload"
        },
        "18": {
            "name": "writeProvidedTextUnitAlternativesPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.ProvidedTextUnitAlternativesAnnotationPayload"
        },
        "19": {
            "name": "writeProvidedAutomaticTextUnitAlternativesPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.ProvidedAutomaticTextUnitAlternativesAnnotationPayload"
        },
        "20": {
            "name": "translatorRequestClarifyPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.RequestClarifyAnnotationPayload"
        },
        "21": {
            "name": "translatorProvidedClarifyQuestionPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ProvidedClarifyQuestionAnnotationPayload"
        },
        "22": {
            "name": "translatorProvidedClarifyHighlightPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ProvidedClarifyHighlightAnnotationPayload"
        },
        "23": {
            "name": "translatorSelectClarifyAnswerPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SelectClarifyAnswerAnnotationPayload"
        },
        "24": {
            "name": "writeRequestChangeStyleAlternativesAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.RequestChangeStyleAlternativesAnnotationPayload"
        },
        "25": {
            "name": "writeProvidedChangeStyleAlternativesAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.ProvidedChangeStyleAlternativesAnnotationPayload"
        },
        "26": {
            "name": "writeSelectChangeStyleAlternativeAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.SelectChangeStyleAlternativeAnnotationPayload"
        },
        "27": {
            "name": "translatorClarifyStatusPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.ClarifyStatusAnnotationPayload"
        },
        "28": {
            "name": "customRuleAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.styleguides.CustomRuleAnnotationPayload"
        },
        "29": {
            "name": "writeRequestTemplateAdaptationAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.RequestTemplateAdaptationAnnotationPayload"
        },
        "30": {
            "name": "writeProvidedTemplateAdaptationAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.ProvidedTemplateAdaptationAnnotationPayload"
        },
        "31": {
            "name": "providedWordAlternativeHighlightPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.alternatives.ProvidedWordAlternativeHighlightPayload"
        },
        "32": {
            "name": "writeInlineSuggestionAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.InlineSuggestionAnnotationPayload"
        },
        "33": {
            "name": "writeInlineSuggestionSpanAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.InlineSuggestionSpanAnnotationPayload"
        },
        "34": {
            "name": "writeActOnInlineSuggestionAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.ActOnInlineSuggestionAnnotationPayload"
        },
        "35": {
            "name": "writeInlineSuggestionsTextUnitStateAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.InlineSuggestionsTextUnitStateAnnotationPayload"
        },
        "36": {
            "name": "writeRequestInlineSuggestionImprovedTextAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.RequestInlineSuggestionImprovedTextAnnotationPayload"
        },
        "37": {
            "name": "writeProvidedInlineSuggestionImprovedTextAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.ProvidedInlineSuggestionImprovedTextAnnotationPayload"
        },
        "38": {
            "name": "translatorRequestRephraseTargetTextAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.RequestRephraseTargetTextAnnotationPayload"
        },
        "39": {
            "name": "translationMemoryAnnotationPayload",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.common.translation_memories.TranslationMemoryAnnotationPayload"
        }
    },
    "deepl.pb.interactive_text_api.RemoveAnnotationOperation": {
        "1": {
            "name": "annotationId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.AnnotationId"
        }
    },
    "deepl.pb.interactive_text_api.SetPropertyOperation": {
        "1": {
            "name": "propertyName",
            "type": "int"
        },
        "2": {
            "name": "translatorSourceLanguagesValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SourceLanguagesPropertyValue"
        },
        "3": {
            "name": "translatorTargetLanguagesValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TargetLanguagesPropertyValue"
        },
        "4": {
            "name": "translatorRequestedSourceLanguageValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.RequestedSourceLanguagePropertyValue"
        },
        "5": {
            "name": "translatorRequestedTargetLanguageValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.RequestedTargetLanguagePropertyValue"
        },
        "7": {
            "name": "translatorFormalityModesValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.FormalityModesPropertyValue"
        },
        "8": {
            "name": "translatorFormalityModeValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.FormalityModePropertyValue"
        },
        "9": {
            "name": "translatorGlossarySupportValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.GlossarySupportPropertyValue"
        },
        "10": {
            "name": "translatorGlossaryListValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.GlossaryListPropertyValue"
        },
        "12": {
            "name": "translatorTextDirectionValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TextDirectionPropertyValue"
        },
        "13": {
            "name": "translatorCalculatedSourceLanguageValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.CalculatedSourceLanguagePropertyValue"
        },
        "14": {
            "name": "translatorMaximumTextLengthValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.MaximumTextLengthPropertyValue"
        },
        "15": {
            "name": "translatorLanguageModelsValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.LanguageModelsPropertyValue"
        },
        "16": {
            "name": "translatorLanguageModelValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.LanguageModelPropertyValue"
        },
        "17": {
            "name": "translatorGlossaryIdValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.GlossaryIdPropertyValue"
        },
        "18": {
            "name": "translatorCalculatedTargetLanguageValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.CalculatedTargetLanguagePropertyValue"
        },
        "19": {
            "name": "translatorUnsupportedSourceLanguageValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.UnsupportedSourceLanguagePropertyValue"
        },
        "20": {
            "name": "writeLanguagesValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.LanguagesPropertyValue"
        },
        "21": {
            "name": "writeRequestedLanguageValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.RequestedLanguagePropertyValue"
        },
        "22": {
            "name": "writeCalculatedLanguageValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.CalculatedLanguagePropertyValue"
        },
        "23": {
            "name": "writeStyleVariantsValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.StyleVariantsPropertyValue"
        },
        "24": {
            "name": "writeStyleVariantValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.StyleVariantPropertyValue"
        },
        "25": {
            "name": "writeGlossaryIdValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.GlossaryIdPropertyValue"
        },
        "26": {
            "name": "writeGlossaryListValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.GlossaryListPropertyValue"
        },
        "27": {
            "name": "writeGlossarySupportValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.GlossarySupportPropertyValue"
        },
        "28": {
            "name": "writeMaximumTextLengthValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.MaximumTextLengthPropertyValue"
        },
        "29": {
            "name": "writeUnsupportedLanguageValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.UnsupportedLanguagePropertyValue"
        },
        "30": {
            "name": "translatorSourceLanguageDetectionWeightsValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SourceLanguageDetectionWeightsPropertyValue"
        },
        "31": {
            "name": "writeGlossaryLanguagesValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.GlossaryLanguagesPropertyValue"
        },
        "32": {
            "name": "writeStyleGuideSupportValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.StyleGuideSupportPropertyValue"
        },
        "33": {
            "name": "writeStyleGuideIdValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.StyleGuideIdPropertyValue"
        },
        "34": {
            "name": "writeTemplateAdaptationTemplatesValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.TemplateAdaptationTemplatesPropertyValue"
        },
        "35": {
            "name": "translatorStyleGuideSupportValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.StyleGuideSupportPropertyValue"
        },
        "36": {
            "name": "translatorStyleGuideIdValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.StyleGuideIdPropertyValue"
        },
        "37": {
            "name": "interfaceLanguageValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.InterfaceLanguagePropertyValue"
        },
        "38": {
            "name": "translatorLanguageModelPreferencesValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.LanguageModelPreferencesPropertyValue"
        },
        "39": {
            "name": "translatorFreeTextPromptListValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.FreeTextPromptListPropertyValue"
        },
        "40": {
            "name": "writeFreeTextPromptListValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.FreeTextPromptListPropertyValue"
        },
        "41": {
            "name": "writeInlineSuggestionsLoadingValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.InlineSuggestionsLoadingPropertyValue"
        },
        "42": {
            "name": "writeCorrectionsOnlySupportValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.CorrectionsOnlySupportPropertyValue"
        },
        "43": {
            "name": "writeCorrectionsOnlyValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.CorrectionsOnlyPropertyValue"
        },
        "44": {
            "name": "translatorRtfSupportValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.RtfSupportPropertyValue"
        },
        "45": {
            "name": "translatorStyleVariantsValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.StyleVariantsPropertyValue"
        },
        "46": {
            "name": "translatorStyleVariantValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.StyleVariantPropertyValue"
        },
        "47": {
            "name": "writeTextUnitAlternativesSupportValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.write.TextUnitAlternativesSupportPropertyValue"
        },
        "48": {
            "name": "translatorTranslationMemoryListValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TranslationMemoryListPropertyValue"
        },
        "49": {
            "name": "translatorSelectedTranslationMemoryValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SelectedTranslationMemoryPropertyValue"
        },
        "50": {
            "name": "translatorRephraseTargetTextStatusValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.RephraseTargetTextStatusPropertyValue"
        }
    },
    "deepl.pb.interactive_text_api.StartSessionRequest": {
        "1": {
            "name": "sessionMode",
            "type": "int"
        },
        "2": {
            "name": "baseDocument",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.BaseDocument"
        },
        "3": {
            "name": "translatorSessionOptions",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SessionOptions"
        },
        "4": {
            "name": "appInformation",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.AppInformation"
        },
        "5": {
            "name": "previousSessionId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.SessionId"
        }
    },
    "deepl.pb.interactive_text_api.StartSessionResponse": {
        "1": {
            "name": "sessionId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.SessionId"
        },
        "2": {
            "name": "participantId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.ParticipantId"
        },
        "3": {
            "name": "sessionToken",
            "type": "string"
        },
        "4": {
            "name": "versionRemovedAt",
            "type": "message",
            "message_type": "google.protobuf.Timestamp"
        },
        "5": {
            "name": "signalrEndpoint",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.ParticipantRequest": {
        "1": {
            "name": "appendMessage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.AppendMessage"
        },
        "2": {
            "name": "updateAuthenticationTokenMessage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.UpdateAuthenticationTokenMessage"
        }
    },
    "deepl.pb.interactive_text_api.ParticipantResponse": {
        "1": {
            "name": "confirmedMessage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.ConfirmedMessage"
        },
        "2": {
            "name": "initializedMessage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.InitializedMessage"
        },
        "3": {
            "name": "publishedMessage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.PublishedMessage"
        },
        "4": {
            "name": "metaInfoMessage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.MetaInfoMessage"
        }
    },
    "deepl.pb.interactive_text_api.ConfirmedMessage": {
        "1": {
            "name": "currentVersion",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.EventVersion"
        },
        "2": {
            "name": "throttlingDelay",
            "type": "message",
            "message_type": "google.protobuf.Duration"
        }
    },
    "deepl.pb.interactive_text_api.InitializedMessage": {},
    "deepl.pb.interactive_text_api.PublishedMessage": {
        "1": {
            "seen_repeated": true,
            "name": "events",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.FieldEvent"
        },
        "2": {
            "name": "currentVersion",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.EventVersion"
        }
    },
    "deepl.pb.interactive_text_api.MetaInfoMessage": {
        "1": {
            "name": "idle",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.Idle"
        },
        "2": {
            "name": "translatorTaskMetaInfo",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TaskMetaInfo"
        }
    },
    "deepl.pb.interactive_text_api.Idle": {
        "1": {
            "name": "eventVersion",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.EventVersion"
        }
    },
    "deepl.pb.interactive_text_api.AppendMessage": {
        "1": {
            "seen_repeated": true,
            "name": "events",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.FieldEvent"
        },
        "2": {
            "name": "baseVersion",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.EventVersion"
        }
    },
    "deepl.pb.interactive_text_api.UpdateAuthenticationTokenMessage": {
        "1": {
            "name": "token",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.AppInformation": {
        "1": {
            "name": "os",
            "type": "string"
        },
        "2": {
            "name": "osVersion",
            "type": "string"
        },
        "3": {
            "name": "appVersion",
            "type": "string"
        },
        "4": {
            "name": "appBuild",
            "type": "string"
        },
        "5": {
            "name": "instanceId",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.SessionId": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.EventVersion.value": {
        "1": {
            "name": "value",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.EventVersion": {
        "1": {
            "name": "version",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.EventVersion.value"
        }
    },
    "deepl.pb.interactive_text_api.FieldEvent": {
        "1": {
            "name": "fieldName",
            "type": "int"
        },
        "2": {
            "name": "textChangeOperation",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.TextChangeOperation"
        },
        "3": {
            "name": "createAnnotationOperation",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.CreateAnnotationOperation"
        },
        "4": {
            "name": "removeAnnotationOperation",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.RemoveAnnotationOperation"
        },
        "5": {
            "name": "setPropertyOperation",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.SetPropertyOperation"
        },
        "6": {
            "name": "participantId",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.ParticipantId"
        }
    },
    "deepl.pb.interactive_text_api.ParticipantId": {
        "1": {
            "name": "value",
            "type": "int"
        }
    },
    "deepl.pb.interactive_text_api.BaseDocument": {
        "1": {
            "seen_repeated": true,
            "name": "fields",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.Field"
        }
    },
    "deepl.pb.interactive_text_api.Field": {
        "1": {
            "name": "fieldName",
            "type": "int"
        },
        "2": {
            "name": "text",
            "type": "string"
        },
        "3": {
            "seen_repeated": true,
            "name": "annotations",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.CreateAnnotationOperation"
        },
        "4": {
            "seen_repeated": true,
            "name": "properties",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.SetPropertyOperation"
        }
    }
};

function buildDtype(wantedType: string): Record<string, any> | null {
    const obj = PROTO_DEF[wantedType];
    if (!obj) return null;
    const result = JSON.parse(JSON.stringify(obj));
    for (const key of Object.keys(result)) {
        const val = result[key];
        if (val.type === "message") {
            val.message_typedef = buildDtype(val.message_type);
            if (val.message_typedef === null) return null;
        }
    }
    return result;
}

function pbEncodeVarint(value: number): Uint8Array {
    const bytes: number[] = [];
    while (value > 0x7f) { bytes.push((value & 0x7f) | 0x80); value >>>= 7; }
    bytes.push(value & 0x7f);
    return new Uint8Array(bytes);
}

function pbEncodeMessage(obj: any, typedef: Record<string, any>): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const [fieldNum, fieldDef] of Object.entries(typedef)) {
        const num = parseInt(fieldNum);
        const { name, type } = fieldDef as any;
        let value = obj?.[name] ?? obj?.[fieldNum];
        if (value === undefined || value === null) continue;
        const items: any[] = (fieldDef as any).seen_repeated && Array.isArray(value) ? value : [value];
        for (const item of items) {
            const tag = pbEncodeVarint((num << 3) | (type === "int" || type === "uint" ? 0 : type === "float" ? 5 : 2));
            if (type === "string") {
                const b = item instanceof Uint8Array ? item : encoder.encode(String(item));
                parts.push(concatU8(tag, pbEncodeVarint(b.length), b));
            } else if (type === "int" || type === "uint") {
                parts.push(concatU8(tag, pbEncodeVarint(typeof item === "number" ? item : parseInt(item))));
            } else if (type === "float") {
                const fb = new Uint8Array(4); new DataView(fb.buffer).setFloat32(0, item, true);
                parts.push(concatU8(tag, fb));
            } else if (type === "message") {
                const nested = pbEncodeMessage(item, (fieldDef as any).message_typedef);
                parts.push(concatU8(tag, pbEncodeVarint(nested.length), nested));
            }
        }
    }
    return concatU8(...parts);
}

function pbDecodeMessage(buf: Uint8Array, typedef: Record<string, any>): any {
    const result: any = {};
    let offset = 0;
    while (offset < buf.length) {
        let tag: number; [tag, offset] = decodeVarint(buf, offset);
        const fieldNum = tag >> 3, wireType = tag & 0x7;
        const fieldDef = typedef[String(fieldNum)];
        if (wireType === 0) {
            let val: number; [val, offset] = decodeVarint(buf, offset);
            if (fieldDef) result[fieldDef.name] = val;
        } else if (wireType === 2) {
            let len: number; [len, offset] = decodeVarint(buf, offset);
            const data = buf.slice(offset, offset + len); offset += len;
            if (fieldDef) {
                if (fieldDef.type === "string") result[fieldDef.name] = decoder.decode(data);
                else if (fieldDef.type === "message") {
                    const nested = pbDecodeMessage(data, fieldDef.message_typedef);
                    if (fieldDef.seen_repeated) { if (!result[fieldDef.name]) result[fieldDef.name] = []; result[fieldDef.name].push(nested); }
                    else result[fieldDef.name] = nested;
                } else result[fieldDef.name] = data;
            }
        } else if (wireType === 5) { offset += 4; }
    }
    return result;
}

function protoDecode(data: Uint8Array, dtype: string): any {
    if (!dtype.includes("deepl.pb.interactive_text_api.")) dtype = `deepl.pb.interactive_text_api.${dtype}`;
    const typedef = buildDtype(dtype);
    return typedef ? pbDecodeMessage(data, typedef) : null;
}

function protoEncode(data: any, dtype: string): Uint8Array | null {
    if (!dtype.includes("deepl.pb.interactive_text_api.")) dtype = `deepl.pb.interactive_text_api.${dtype}`;
    const typedef = buildDtype(dtype);
    return typedef ? pbEncodeMessage(data, typedef) : null;
}

// ─────────────────────────────────────────────
// DEEPL TRANSLATOR
// ─────────────────────────────────────────────

function textChangeOperation(
    original: string,
    newText: string | Uint8Array,
    range?: { start?: number; end?: number }
): string {
    const text = newText instanceof Uint8Array ? decoder.decode(newText) : newText;
    const start = typeof range?.start === "number" ? range.start : 0;
    const end = typeof range?.end === "number" ? range.end : 0;
    return original.slice(0, start) + text + original.slice(end);
}

export class FreeDeepLTranslator {
    private ws: WebSocket | null = null;
    private recvMessages: any[] = [];
    private status: boolean | null = null;
    private onErrorLast = "";
    private token = "";
    private bver: any = null;
    private config: Record<string, any> = {};
    private input = "";
    private output = "";

    private async formatRes(raw: Uint8Array): Promise<any[]> {
        if (raw[raw.length - 1] === 0x1e && raw[0] === 123 && raw[raw.length - 2] === 125) {
            return [JSON.parse(decoder.decode(raw.slice(0, -1)))];
        }
        const chunks = msgpackUnpack(raw);
        const returnData: any[] = [];
        for (const chunk of chunks) {
            const [msg] = mpDecode(chunk);
            if (Array.isArray(msg) && msg.length >= 4 && msg[3] === "OnError") {
                const err = protoDecode(msg[4][0].data, "signalr.ClientErrorInfo");
                this.onErrorLast = err?.detailCode?.value ?? "";
                await this.close();
                this.status = false;
                returnData.push(msg);
            } else if (Array.isArray(msg) && msg[0] === 6) {
                this.wsSend(msgpackPack([mpEncode([6])]));
            } else {
                returnData.push(msg);
            }
        }
        return returnData;
    }

    private wsSend(data: Uint8Array): void {
        this.ws?.send(data);
    }

    private connectWs(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(url);
            this.ws.binaryType = "arraybuffer";
            this.ws.onopen = () => resolve();
            this.ws.onerror = (e) => reject(e);
            this.ws.onmessage = async (event) => {
                const raw = event.data instanceof ArrayBuffer
                    ? new Uint8Array(event.data)
                    : encoder.encode(event.data as string);
                const parsed = await this.formatRes(raw);
                for (const m of parsed) this.recvMessages.push(m);
            };
            this.ws.onclose = () => { this.status = false; };
        });
    }

    private async popMessage(timeout = 5000): Promise<any | null> {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (this.recvMessages.length > 0) return this.recvMessages.shift();
            await new Promise((r) => setTimeout(r, 50));
        }
        return null;
    }

    async close(): Promise<void> {
        this.ws?.close();
        this.ws = null;
        this.status = null;
    }

    private async connect(): Promise<void> {
        if (this.status === true) return;
        this.status = false;

        const negoRes = await fetch(
            "https://ita-free.www.deepl.com/v1/sessions/negotiate?negotiateVersion=1",
            { method: "POST" }
        );
        if (!negoRes.ok) throw new Error("Negotiate failed");
        const nego = await negoRes.json();
        const wsUrl = `wss://ita-free.www.deepl.com/v1/sessions?id=${nego.connectionToken}`;

        await this.connectWs(wsUrl);

        this.wsSend(encoder.encode('{"protocol":"messagepack","version":1}\x1e'));
        const msg0 = await this.popMessage();
        if (msg0 && Object.keys(msg0).length !== 0) throw new Error("Handshake failed");

        this.wsSend(fromBase64(
            "TpUBgKEwrFN0YXJ0U2Vzc2lvbpHHOAEIARIwCgsIASIHCA5yAwjcCwohCAIiDQgFKgkKBwoFZW4tVVMiDggSkgEJCgcKBWVuLVVTGgIQAQ=="
        ));

        const msg1 = await this.popMessage();
        if (!msg1) throw new Error("No StartSession response");

        const sessionDecoded = protoDecode(msg1[4].data, "StartSessionResponse");
        this.token = sessionDecoded?.sessionToken;

        this.wsSend(msgpackPack([mpEncode([1, {}, null, "AppendMessages", [this.token], ["1"]])]));
        this.wsSend(msgpackPack([mpEncode([4, {}, "2", "GetMessages", [this.token, new MsgExt(3, new Uint8Array(0))]])]));

        const msg2 = await this.popMessage();
        if (!msg2 || msg2[3] === "OnError") throw new Error("GetMessages failed");

        const pub = protoDecode(msg2[3].data, "ParticipantResponse")?.publishedMessage;
        this.bver = pub?.currentVersion?.version?.value;
        this.config.source_langs = ["en"];
        this.config.target_langs = ["en"];
        this.config.maximum_text_length = 0;

        for (const evt of pub?.events ?? []) {
            const op = evt?.setPropertyOperation;
            if (op?.propertyName === 1)
                for (const l of op.translatorSourceLanguagesValue?.sourceLanguages ?? [])
                    this.config.source_langs.push(l.code);
            if (op?.propertyName === 2)
                for (const l of op.translatorTargetLanguagesValue?.targetLanguages ?? [])
                    this.config.target_langs.push(l.code);
            if (op?.propertyName === 14 && evt.fieldName === 1)
                this.config.maximum_text_length = op.translatorMaximumTextLengthValue?.max ?? 0;
        }

        await this.popMessage();
        this.status = true;
    }

    async translate(context: { text: string; from: string; to: string }): Promise<string> {
        const { text, from, to } = context;

        if (this.status !== true) await this.connect();

        if (text.length >= this.config.maximum_text_length)
            throw new Error(`Text too long (max ${this.config.maximum_text_length})`);
        if (!this.config.target_langs.includes(to))
            throw new Error(`Invalid target language: ${to}`);
        if (from && !this.config.source_langs.includes(from))
            throw new Error(`Invalid source language: ${from}`);

        const lst: any[] = [
            {
                fieldName: 2,
                setPropertyOperation: { propertyName: 8, translatorFormalityModeValue: { formalityMode: {} } },
                participantId: { value: 2 },
            },
            {
                fieldName: 2,
                setPropertyOperation: { propertyName: 10, translatorGlossaryListValue: { glossaryEntries: [] } },
                participantId: { value: 2 },
            },
            {
                fieldName: 2,
                setPropertyOperation: {
                    propertyName: 5,
                    translatorRequestedTargetLanguageValue: { targetLanguage: { code: encoder.encode(to) } },
                },
                participantId: { value: 2 },
            },
            from
                ? {
                    fieldName: 1,
                    setPropertyOperation: {
                        propertyName: 3,
                        translatorRequestedSourceLanguageValue: { sourceLanguage: { code: encoder.encode(from) } },
                    },
                    participantId: { value: 2 },
                }
                : {
                    fieldName: 1,
                    setPropertyOperation: { propertyName: 3 },
                    participantId: { value: 2 },
                },
            {
                fieldName: 1,
                textChangeOperation: { range: { end: this.input.length }, text: encoder.encode(text) },
                participantId: { value: 2 },
            },
        ];

        const encoded = protoEncode(
            { appendMessage: { events: lst, baseVersion: { version: { value: this.bver } } } },
            "ParticipantRequest"
        );
        if (!encoded) throw new Error("protoEncode failed");

        this.input = text;
        this.wsSend(msgpackPack([mpEncode([2, {}, "1", new MsgExt(4, encoded)])]));

        const msg = await this.popMessage();
        if (!msg || msg[3] === "OnError") throw new Error(this.onErrorLast || "Translation failed");

        const confirmed = protoDecode(msg[3].data, "ParticipantResponse");
        if (!confirmed?.confirmedMessage) throw new Error("No confirmation");

        while (true) {
            const i = await this.popMessage();
            if (!i || i[3] === "OnError") throw new Error(this.onErrorLast || "Translation failed");

            const js = protoDecode(i[3].data, "ParticipantResponse");
            if (js?.metaInfoMessage?.idle != null) break;

            if (js?.publishedMessage) {
                if (js.publishedMessage?.currentVersion?.version?.value != null)
                    this.bver = js.publishedMessage.currentVersion.version.value;
                let events = js.publishedMessage?.events;
                if (events && !Array.isArray(events)) events = [events];
                for (const evt of events ?? []) {
                    if (evt?.textChangeOperation) {
                        const op = evt.textChangeOperation;
                        if (evt.fieldName === 2) this.output = textChangeOperation(this.output, op.text, op.range);
                        else if (evt.fieldName === 1) this.input = textChangeOperation(this.input, op.text, op.range);
                    }
                }
            }
        }

        return this.output;
    }
}
