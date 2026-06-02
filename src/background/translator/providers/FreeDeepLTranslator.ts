import {
    decoder,
    encoder,
    fromBase64,
    MsgExt,
    mpDecode,
    mpEncode,
    msgpackPack,
    msgpackUnpack,
} from './freeDeepLBinary.ts'
import {protoDecode, protoEncode} from './freeDeepLProto.ts'

type FreeDeepLConfig = {
    sourceLangs: string[]
    targetLangs: string[]
    maximumTextLength: number
}

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
    private config: FreeDeepLConfig = {
        sourceLangs: ["en"],
        targetLangs: ["en"],
        maximumTextLength: 0,
    };
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
        this.loadConfig(pub);

        await this.popMessage();
        this.status = true;
    }

    private loadConfig(publishedMessage: any): void {
        const next: FreeDeepLConfig = {
            sourceLangs: ["en"],
            targetLangs: ["en"],
            maximumTextLength: 0,
        };

        for (const evt of publishedMessage?.events ?? []) {
            const op = evt?.setPropertyOperation;
            if (op?.propertyName === 1) {
                for (const language of op.translatorSourceLanguagesValue?.sourceLanguages ?? []) {
                    next.sourceLangs.push(language.code);
                }
            }
            if (op?.propertyName === 2) {
                for (const language of op.translatorTargetLanguagesValue?.targetLanguages ?? []) {
                    next.targetLangs.push(language.code);
                }
            }
            if (op?.propertyName === 14 && evt.fieldName === 1) {
                next.maximumTextLength = op.translatorMaximumTextLengthValue?.max ?? 0;
            }
        }

        this.config = next;
    }

    private assertCanTranslate(text: string, from: string, to: string): void {
        if (text.length >= this.config.maximumTextLength) {
            throw new Error(`Text too long (max ${this.config.maximumTextLength})`);
        }
        if (!this.config.targetLangs.includes(to)) {
            throw new Error(`Invalid target language: ${to}`);
        }
        if (from && !this.config.sourceLangs.includes(from)) {
            throw new Error(`Invalid source language: ${from}`);
        }
    }

    private createTranslationEvents(text: string, from: string, to: string): any[] {
        return [
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
    }

    private applyPublishedMessage(publishedMessage: any): void {
        if (publishedMessage?.currentVersion?.version?.value != null) {
            this.bver = publishedMessage.currentVersion.version.value;
        }

        let events = publishedMessage?.events;
        if (events && !Array.isArray(events)) events = [events];

        for (const evt of events ?? []) {
            if (!evt?.textChangeOperation) continue;

            const op = evt.textChangeOperation;
            if (evt.fieldName === 2) {
                this.output = textChangeOperation(this.output, op.text, op.range);
            } else if (evt.fieldName === 1) {
                this.input = textChangeOperation(this.input, op.text, op.range);
            }
        }
    }

    async translate(context: { text: string; from: string; to: string }): Promise<string> {
        const { text, from, to } = context;

        if (this.status !== true) await this.connect();

        this.assertCanTranslate(text, from, to);

        const encoded = protoEncode(
            { appendMessage: { events: this.createTranslationEvents(text, from, to), baseVersion: { version: { value: this.bver } } } },
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
                this.applyPublishedMessage(js.publishedMessage);
            }
        }

        return this.output;
    }
}
