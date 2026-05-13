const modeService = require('../services/modeService');

/**
 * Get company name with priority fallback:
 * 1. settings.companyName
 * 2. userWhatsappBotModel.botName (if multi mode)
 * 3. process.env.BOT_NAME
 * 4. 'KOALASTORE.DIGI'
 *
 * @param {Object} settings - Settings object from settingsService
 * @param {String} botId - Bot ID (required for multi mode to fetch botName)
 * @returns {Promise<String>} Company name
 */
async function getCompanyName(settings, botId = null) {
  if (settings?.companyName) {
    return settings.companyName;
  }

  if (modeService.isMultiMode() && botId) {
    try {
      const UserWhatsappBotModel = require('../database/models/userWhatsappBotModels');
      const bot = await UserWhatsappBotModel.findById(botId);
      if (bot?.botName) {
        return bot.botName;
      }
    } catch (error) {
      console.error('Error fetching bot name:', error);
    }
  }

  if (process.env.BOT_NAME) {
    return process.env.BOT_NAME;
  }

  return 'KOALASTORE.DIGI';
}

module.exports = { getCompanyName };
