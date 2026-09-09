jest.mock('../src/utils/checkRole', () => ({ isAdmin: jest.fn() }));
jest.mock('../src/services/modeService', () => ({
    isSingleMode: jest.fn(),
    isMultiMode: jest.fn(),
}));
jest.mock('../src/database/models/settingModel', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
}));
jest.mock('../src/actions', () => ({}));
jest.mock('../src/command/exportCommand', () => ({
    toggleRating: require('../src/command/privateCommand/toggleFeature').toggleRating,
    caraToggleFeature: require('../src/command/helpCommand/caraToggleFeature'),
    caraToggleRating: require('../src/command/helpCommand/caraToggleRating'),
}));

const { isAdmin } = require('../src/utils/checkRole');
const modeService = require('../src/services/modeService');
const model = require('../src/database/models/settingModel');
const repository = require('../src/repositories/settingsRepository');
const settingsService = require('../src/services/settingsService');
const { toggleRating } = require('../src/command/privateCommand/toggleFeature');
const generalHelp = require('../src/command/helpCommand/caraToggleFeature');
const help = require('../src/command/helpCommand/caraToggleRating');
const menu = require('../src/command/privateCommand/adminPanel');
const registerCommands = require('../src/config/registerCommands');

function context(commandArgs = [], botId = 'bot-a') {
    return {
        from: '123@s.whatsapp.net', state: { botId }, commandArgs,
        reply: jest.fn().mockResolvedValue(undefined),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    isAdmin.mockResolvedValue(true);
    modeService.isSingleMode.mockReturnValue(true);
    repository._invalidateCache();
    modeService.isSingleMode.mockReturnValue(false);
    for (const id of ['bot-a', 'bot-b', null]) repository._invalidateCache(id);
    modeService.isSingleMode.mockReturnValue(true);
    modeService.isMultiMode.mockReturnValue(false);
    model.findOne.mockResolvedValue({ ratingEnabled: true });
    model.findOneAndUpdate.mockResolvedValue({ ratingEnabled: false });
});

afterEach(() => jest.restoreAllMocks());

test('registers a dedicated rating tutorial separately from general help', () => {
    const router = { command: jest.fn(), start: jest.fn() };
    registerCommands(router);
    expect(router.command).toHaveBeenCalledWith('togglerating', toggleRating);
    expect(router.command).toHaveBeenCalledWith(
        ['caratoggle', 'caratogglefitur'], generalHelp
    );
    expect(router.command).toHaveBeenCalledWith('caratogglerating', help);
    expect(help).not.toBe(generalHelp);
});

test.each([toggleRating, help, generalHelp, menu])('rejects non-admin access before settings reads', async (handler) => {
    isAdmin.mockResolvedValue(false);
    const ctx = context(['off']);
    await handler(ctx);
    expect(isAdmin).toHaveBeenCalledWith(ctx.from, ctx);
    expect(model.findOne).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith('*Akses ditolak.* Perintah ini hanya untuk admin.');
});

test.each([undefined, true, false])('no args shows current/default status without writing: %s', async (value) => {
    model.findOne.mockResolvedValue({ ratingEnabled: value });
    const ctx = context();
    await toggleRating(ctx);
    const text = ctx.reply.mock.calls[0][0];
    expect(text).toContain('Pengaturan Fitur Rating Produk');
    expect(text).toContain(value === false ? 'Nonaktif' : 'Aktif');
    expect(text).toContain('.caratogglerating');
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
});

test.each([false, true])('persists on/off with correct scope and invalidates cache (single=%s)', async (single) => {
    modeService.isSingleMode.mockReturnValue(single);
    const ctx = context(['OFF']);
    await settingsService.getSettings(ctx);
    await toggleRating(ctx);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        single ? {} : { botId: 'bot-a' },
        { $set: { ratingEnabled: false } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    expect(ctx.reply.mock.calls[0][0]).toContain('berhasil dinonaktifkan');
    model.findOne.mockResolvedValue({ ratingEnabled: false });
    expect(await settingsService.getSettings(ctx)).toEqual({ ratingEnabled: false });
    expect(model.findOne).toHaveBeenCalledTimes(2);
    ctx.commandArgs = ['on'];
    await toggleRating(ctx);
    expect(model.findOneAndUpdate.mock.calls.at(-1)[1]).toEqual({ $set: { ratingEnabled: true } });
    expect(ctx.reply.mock.calls.at(-1)[0]).toContain('berhasil diaktifkan');
});

test('multi-mode writes leave another bot cache untouched', async () => {
    modeService.isSingleMode.mockReturnValue(false);
    const other = context([], 'bot-b');
    await settingsService.getSettings(other);
    await toggleRating(context(['off']));
    model.findOne.mockClear();
    expect(await settingsService.getSettings(other)).toEqual({ ratingEnabled: true });
    expect(model.findOne).not.toHaveBeenCalled();
});

test.each([['maybe'], ['on', 'off']])('invalid args do not write: %s', async (...args) => {
    const ctx = context(args);
    await toggleRating(ctx);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ctx.reply.mock.calls[0][0]).toContain('Nilai tidak valid');
});

test.each([undefined, true, false])('unchanged value does not write: %s', async (value) => {
    model.findOne.mockResolvedValue({ ratingEnabled: value });
    const ctx = context([value === false ? 'off' : 'on']);
    await toggleRating(ctx);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ctx.reply.mock.calls[0][0]).toContain('Tidak ada perubahan');
});

test('persistence failure reports an error instead of success', async () => {
    model.findOneAndUpdate.mockRejectedValueOnce(new Error('write failed'));
    const ctx = context(['off']);
    await toggleRating(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith('*Terjadi kesalahan, silakan coba lagi.*');
});

test('tutorial explains ratings, usage and effects without technical jargon', async () => {
    const ctx = context();
    await help(ctx);
    const text = ctx.reply.mock.calls[0][0];
    for (const expected of [
        '.togglerating on', '.togglerating off', '.togglerating`', '.caratogglerating',
        'khusus admin bot', 'tidak dihapus', 'ringkasan rating', 'penilaian baru',
        'bintang dan ulasan', 'tanpa mengubah pengaturan', '.adminmenu',
    ]) expect(text).toContain(expected);
    expect(text).not.toMatch(/ratingEnabled|backend|single|multi|restart/i);
    expect(text).not.toContain('.togglesaldo');
    await generalHelp(ctx);
    expect(ctx.reply.mock.calls.at(-1)[0]).not.toContain('togglerating');
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
});

test.each([false, true])('admin menu lists rating under the existing feature section (multi=%s)', async (multi) => {
    modeService.isMultiMode.mockReturnValue(multi);
    const ctx = context();
    await menu(ctx);
    const text = ctx.reply.mock.calls[0][0];
    const features = text.split('*CS & Fitur*')[1].split('*Group Settings*')[0];
    expect(features).toContain('Rating Produk');
    expect(features).toContain('bintang dan ulasan');
    expect(features).toContain('`.togglerating` - Cek status');
    expect(features).not.toMatch(/ratingEnabled|backend|single|multi|restart|on\|off/i);
    expect(features).toContain('.caratogglerating');
});
