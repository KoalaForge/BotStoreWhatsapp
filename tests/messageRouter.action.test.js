const MessageRouter = require('../src/config/messageRouter');

function makeCtx(callbackData) {
    return {
        message: '',
        isCallback: true,
        callbackData,
        match: null
    };
}

describe('MessageRouter.action() pattern dispatch', () => {
    test('regex pattern captures callback arg', async () => {
        const router = new MessageRouter();
        const seen = [];
        router.action(/^prod:(.+)$/, async (ctx) => { seen.push(ctx.match[1]); });
        const handled = await router.route(makeCtx('prod:SKU-123'));
        expect(handled).toBe(true);
        expect(seen).toEqual(['SKU-123']);
    });

    test('exact-string pattern matches', async () => {
        const router = new MessageRouter();
        let hit = false;
        router.action('pay:confirm', async () => { hit = true; });
        await router.route(makeCtx('pay:confirm'));
        expect(hit).toBe(true);
    });

    test('wrong callback does not match unrelated action', async () => {
        const router = new MessageRouter();
        let hit = false;
        router.action('order:qris', async () => { hit = true; });
        const handled = await router.route(makeCtx('order:saldo'));
        expect(hit).toBe(false);
        // No fallback registered → unhandled
        expect(handled).toBe(false);
    });

    test('topup regex accepts numeric and rejects bad input', async () => {
        const router = new MessageRouter();
        const hits = [];
        router.action(/^topup:(\d+)$/, async (ctx) => { hits.push(ctx.match[1]); });
        await router.route(makeCtx('topup:50000'));
        await router.route(makeCtx('topup:custom'));
        expect(hits).toEqual(['50000']);
    });

    test('page regex accepts next/prev/digits', async () => {
        const router = new MessageRouter();
        const hits = [];
        router.action(/^page:(next|prev|\d+)$/, async (ctx) => { hits.push(ctx.match[1]); });
        await router.route(makeCtx('page:next'));
        await router.route(makeCtx('page:prev'));
        await router.route(makeCtx('page:3'));
        expect(hits).toEqual(['next', 'prev', '3']);
    });
});
