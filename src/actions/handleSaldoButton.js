async function handleSaldoButton(ctx) {
    try {
        const saldoCommand = require('../command/publicCommand/saldo');
        await saldoCommand(ctx);
    } catch (error) {
        console.error("Error handling saldo button:", error);
        await ctx.reply("*Terjadi kesalahan saat mengakses saldo.*");
    }
}

module.exports = handleSaldoButton;
