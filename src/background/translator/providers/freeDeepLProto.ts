import {concatU8, decodeVarint, decoder, encoder} from './freeDeepLBinary.ts'

const PROTO_DEF: Record<string, Record<string, any>> = {
    "deepl.pb.interactive_text_api.signalr.DetailCode": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.signalr.ClientErrorInfo": {
        "2": {
            "name": "detailCode",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.signalr.DetailCode"
        }
    },
    "deepl.pb.interactive_text_api.StartSessionResponse": {
        "3": {
            "name": "sessionToken",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.ParticipantResponse": {
        "1": {
            "name": "confirmedMessage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.ConfirmedMessage"
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
    "deepl.pb.interactive_text_api.ConfirmedMessage": {},
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
        }
    },
    "deepl.pb.interactive_text_api.Idle": {},
    "deepl.pb.interactive_text_api.ParticipantRequest": {
        "1": {
            "name": "appendMessage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.AppendMessage"
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
        "8": {
            "name": "translatorFormalityModeValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.FormalityModePropertyValue"
        },
        "10": {
            "name": "translatorGlossaryListValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.GlossaryListPropertyValue"
        },
        "14": {
            "name": "translatorMaximumTextLengthValue",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.MaximumTextLengthPropertyValue"
        }
    },
    "deepl.pb.interactive_text_api.ParticipantId": {
        "1": {
            "name": "value",
            "type": "int"
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
    "deepl.pb.interactive_text_api.translator.RequestedSourceLanguagePropertyValue": {
        "1": {
            "name": "sourceLanguage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.SourceLanguage"
        }
    },
    "deepl.pb.interactive_text_api.translator.RequestedTargetLanguagePropertyValue": {
        "1": {
            "name": "targetLanguage",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.TargetLanguage"
        }
    },
    "deepl.pb.interactive_text_api.translator.FormalityMode": {
        "1": {
            "name": "value",
            "type": "string"
        }
    },
    "deepl.pb.interactive_text_api.translator.FormalityModePropertyValue": {
        "1": {
            "name": "formalityMode",
            "type": "message",
            "message_type": "deepl.pb.interactive_text_api.translator.FormalityMode"
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
    "deepl.pb.interactive_text_api.translator.MaximumTextLengthPropertyValue": {
        "1": {
            "name": "max",
            "type": "int"
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

export function protoDecode(data: Uint8Array, dtype: string): any {
    if (!dtype.includes("deepl.pb.interactive_text_api.")) dtype = `deepl.pb.interactive_text_api.${dtype}`;
    const typedef = buildDtype(dtype);
    return typedef ? pbDecodeMessage(data, typedef) : null;
}

export function protoEncode(data: any, dtype: string): Uint8Array | null {
    if (!dtype.includes("deepl.pb.interactive_text_api.")) dtype = `deepl.pb.interactive_text_api.${dtype}`;
    const typedef = buildDtype(dtype);
    return typedef ? pbEncodeMessage(data, typedef) : null;
}
