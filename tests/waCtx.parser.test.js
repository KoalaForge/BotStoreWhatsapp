const WaCtx = require('../src/whatsapp/WaCtx');

function makeMsg(messageContent, key = {}) {
    return {
        key: { remoteJid: '6281234567890@s.whatsapp.net', fromMe: false, id: 'X', ...key },
        pushName: 'Tester',
        message: messageContent
    };
}

const sockStub = {};

describe('WaCtx message + callback extraction', () => {
    test('plain conversation text', () => {
        const ctx = new WaCtx(sockStub, makeMsg({ conversation: 'halo' }));
        expect(ctx.message).toBe('halo');
        expect(ctx.callbackData).toBeNull();
        expect(ctx.isCallback).toBe(false);
    });

    test('extendedTextMessage', () => {
        const ctx = new WaCtx(sockStub, makeMsg({
            extendedTextMessage: { text: 'list produk' }
        }));
        expect(ctx.message).toBe('list produk');
        expect(ctx.isCallback).toBe(false);
    });

    test('legacy buttonsResponseMessage sets callbackData', () => {
        const ctx = new WaCtx(sockStub, makeMsg({
            buttonsResponseMessage: {
                selectedButtonId: 'order:qris',
                selectedDisplayText: 'Bayar QRIS'
            }
        }));
        expect(ctx.message).toBe('Bayar QRIS');
        expect(ctx.callbackData).toBe('order:qris');
        expect(ctx.isCallback).toBe(true);
    });

    test('legacy listResponseMessage sets callbackData', () => {
        const ctx = new WaCtx(sockStub, makeMsg({
            listResponseMessage: {
                title: 'Pilih',
                singleSelectReply: { selectedRowId: 'prod:ABC' }
            }
        }));
        // message getter populates callbackData as a side effect
        void ctx.message;
        expect(ctx.callbackData).toBe('prod:ABC');
        expect(ctx.isCallback).toBe(true);
    });

    test('nativeFlow quick_reply (paramsJson with id + display_text)', () => {
        const ctx = new WaCtx(sockStub, makeMsg({
            interactiveResponseMessage: {
                nativeFlowResponseMessage: {
                    name: 'quick_reply',
                    paramsJson: JSON.stringify({ id: 'pay:confirm', display_text: 'Ya, Bayar' }),
                    version: 2
                }
            }
        }));
        expect(ctx.message).toBe('Ya, Bayar');
        expect(ctx.callbackData).toBe('pay:confirm');
        expect(ctx.isCallback).toBe(true);
    });

    test('nativeFlow single_select (paramsJson with selected_id)', () => {
        const ctx = new WaCtx(sockStub, makeMsg({
            interactiveResponseMessage: {
                nativeFlowResponseMessage: {
                    name: 'single_select',
                    paramsJson: JSON.stringify({ selected_id: 'var:V123' }),
                    version: 2
                }
            }
        }));
        void ctx.message;
        expect(ctx.callbackData).toBe('var:V123');
        expect(ctx.isCallback).toBe(true);
    });

    test('templateButtonReplyMessage', () => {
        const ctx = new WaCtx(sockStub, makeMsg({
            templateButtonReplyMessage: {
                selectedId: 'nav:back',
                selectedDisplayText: 'Kembali'
            }
        }));
        expect(ctx.message).toBe('Kembali');
        expect(ctx.callbackData).toBe('nav:back');
        expect(ctx.isCallback).toBe(true);
    });

    test('malformed paramsJson does not throw', () => {
        const ctx = new WaCtx(sockStub, makeMsg({
            interactiveResponseMessage: {
                nativeFlowResponseMessage: {
                    name: 'quick_reply',
                    paramsJson: 'not-json'
                }
            }
        }));
        expect(ctx.message).toBe('');
    });
});
