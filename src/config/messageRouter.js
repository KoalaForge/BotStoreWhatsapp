const clc = require('cli-color');

/**
 * MessageRouter - Routes incoming WhatsApp messages to handlers.
 *
 * Replaces Telegraf's bot.command(), bot.hears(), bot.action() system.
 * Supports:
 * - Dot-prefix commands: .addproduct, .start, etc.
 * - Button/list callback responses: matched by button ID pattern
 * - Text pattern matching (hears): regex or exact string
 * - Middleware chain: runs before any handler
 *
 * Priority order:
 * 1. Middleware chain (all run in order, can short-circuit)
 * 2. Button/list callbacks (matched by callbackData)
 * 3. Dot-prefix commands
 * 4. Hears patterns (regex/string)
 * 5. Fallback text handler
 */
class MessageRouter {
    constructor() {
        this._middleware = [];
        this._commands = new Map();       // Map<commandName, { handler, aliases }>
        this._actions = [];               // [{ pattern: string|RegExp, handler }]
        this._hears = [];                 // [{ pattern: string|RegExp, handler }]
        this._textFallback = null;        // Catch-all for unmatched text
        this._startHandler = null;        // Special handler for .start / first message
    }

    // ==========================================
    // Registration Methods
    // ==========================================

    /**
     * Register middleware (runs before handlers, in order).
     * Middleware signature: async (ctx, next) => void
     * Call next() to continue, or return without calling to short-circuit.
     */
    use(middleware) {
        this._middleware.push(middleware);
        return this;
    }

    /**
     * Register a .start handler (also triggered on first message / "hi"/"hello").
     * @param {Function} handler - async (ctx) => void
     */
    start(handler) {
        this._startHandler = handler;
        this.command('start', handler);
        return this;
    }

    /**
     * Register a dot-prefix command handler.
     * @param {string|string[]} names - Command name(s) without dot (e.g. "addproduct" or ["addproduct", "addproduk"])
     * @param {Function} handler - async (ctx) => void
     */
    command(names, handler) {
        const nameList = Array.isArray(names) ? names : [names];
        const primary = nameList[0].toLowerCase();

        this._commands.set(primary, { handler, aliases: nameList.map(n => n.toLowerCase()) });

        // Also register aliases as direct lookups
        for (const alias of nameList) {
            if (alias.toLowerCase() !== primary) {
                this._commands.set(alias.toLowerCase(), { handler, aliases: nameList.map(n => n.toLowerCase()) });
            }
        }
        return this;
    }

    /**
     * Register a callback action handler (button ID or list row ID).
     * @param {string|string[]|RegExp} pattern - Exact string(s), or regex for callback data
     * @param {Function} handler - async (ctx) => void
     */
    action(pattern, handler) {
        if (Array.isArray(pattern)) {
            for (const p of pattern) {
                this._actions.push({ pattern: p, handler });
            }
        } else {
            this._actions.push({ pattern, handler });
        }
        return this;
    }

    /**
     * Register a text pattern handler (hears).
     * @param {string|RegExp} pattern - Exact string or regex
     * @param {Function} handler - async (ctx) => void
     */
    hears(pattern, handler) {
        this._hears.push({ pattern, handler });
        return this;
    }

    /**
     * Register a fallback handler for unmatched text messages.
     * @param {Function} handler - async (ctx) => void
     */
    onText(handler) {
        this._textFallback = handler;
        return this;
    }

    // ==========================================
    // Routing
    // ==========================================

    /**
     * Route an incoming message through middleware and handlers.
     * @param {WaCtx} ctx - WhatsApp context
     * @returns {Promise<boolean>} true if handled, false if no match
     */
    async route(ctx) {
        // Run middleware chain
        let middlewareIndex = 0;
        let middlewareContinued = true;

        const runMiddleware = async () => {
            while (middlewareIndex < this._middleware.length) {
                const mw = this._middleware[middlewareIndex];
                middlewareIndex++;

                let nextCalled = false;
                await mw(ctx, () => { nextCalled = true; });

                if (!nextCalled) {
                    middlewareContinued = false;
                    return; // Short-circuited
                }
            }
        };

        await runMiddleware();
        if (!middlewareContinued) return true; // Middleware handled it

        const text = ctx.message?.trim() || '';

        // 1. Handle dot-prefix commands
        if (text.startsWith('.')) {
            return this._routeCommand(ctx, text);
        }

        // 2. Handle first-message / greeting as .start
        if (this._startHandler && this._isGreeting(text)) {
            await this._startHandler(ctx);
            return true;
        }

        // 3. Try action routing on plain text (action handlers fire on typed pattern matches)
        if (await this._routeAction(ctx, text)) {
            return true;
        }

        // 4. Try hears patterns
        for (const entry of this._hears) {
            const match = this._matchPattern(text, entry.pattern);
            if (match) {
                ctx.match = match;
                await entry.handler(ctx);
                return true;
            }
        }

        // 6. Fallback text handler
        if (this._textFallback) {
            await this._textFallback(ctx);
            return true;
        }

        return false;
    }

    /**
     * Route to a registered action handler.
     * @private
     */
    async _routeAction(ctx, data) {
        for (const entry of this._actions) {
            const match = this._matchPattern(data, entry.pattern);
            if (match) {
                ctx.match = match;
                ctx.callbackData = data;
                await entry.handler(ctx);
                return true;
            }
        }
        return false;
    }

    /**
     * Route to a registered command handler.
     * @private
     */
    async _routeCommand(ctx, text) {
        // Parse: ".commandname arg1 arg2 arg3"
        const parts = text.slice(1).split(/\s+/);
        const cmdName = parts[0].toLowerCase();
        const args = parts.slice(1);

        const entry = this._commands.get(cmdName);
        if (entry) {
            // Store command args in ctx for handler access
            ctx.command = cmdName;
            ctx.commandArgs = args;
            ctx.commandText = parts.slice(1).join(' ');
            // For compatibility: ctx.match = [fullText, ...capturedGroups]
            ctx.match = [text, ...args];
            await entry.handler(ctx);
            return true;
        }

        return false;
    }

    /**
     * Check if text is a greeting (triggers .start).
     * @private
     */
    _isGreeting(text) {
        const greetings = ['hi', 'hello', 'halo', 'hai', 'hey', 'menu', 'mulai', 'start', 'bantuan', 'help'];
        return greetings.includes(text.toLowerCase());
    }

    /**
     * Match a string against a pattern (string or regex).
     * @returns {Array|null} Match array or null
     * @private
     */
    _matchPattern(text, pattern) {
        if (typeof pattern === 'string') {
            return text === pattern ? [text] : null;
        }
        if (pattern instanceof RegExp) {
            const match = text.match(pattern);
            return match || null;
        }
        return null;
    }

    /**
     * Get all registered command names (for help/listing).
     * @returns {string[]}
     */
    getCommandList() {
        const seen = new Set();
        const commands = [];
        for (const [name, entry] of this._commands) {
            const primary = entry.aliases[0];
            if (!seen.has(primary)) {
                seen.add(primary);
                commands.push(primary);
            }
        }
        return commands;
    }
}

module.exports = MessageRouter;
