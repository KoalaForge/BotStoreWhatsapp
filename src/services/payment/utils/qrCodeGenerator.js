const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');
const { createCanvas, loadImage } = require('canvas');
const settingsService = require('../../settingsService');
const modeService = require('../../modeService');

/**
 * Overlay QR code on a template image
 * @param {string} qrisText QRIS text content
 * @param {string} templatePath path to template image
 * @param {Object} options styling options
 * @param {string} [options.color='#382C01'] QR code color
 * @param {number} [options.qrSize=320] QR code size in pixels
 * @param {number} [options.qrX] X position for QR code (center if not specified)
 * @param {number} [options.qrY=480] Y position for QR code (center if not specified)
 * @param {number} [options.borderRadius=0.1] border radius as percentage (0.05 = 5%)
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function overlayQROnTemplate(qrisText, templatePath, options = {}) {
  const {
    color = '#382C01',
    qrSize = 320,
    qrX,
    qrY = 480,
    borderRadius = 0.1
  } = options;

  // No cache — always load fresh so DB changes are reflected immediately
  let templateImage;
  try {
    // For HTTP/HTTPS URLs, pre-fetch via axios so loadImage gets a reliable buffer
    if (/^https?:\/\//i.test(templatePath)) {
      const response = await axios.get(templatePath, { responseType: 'arraybuffer', timeout: 10000 });
      templateImage = await loadImage(Buffer.from(response.data));
    } else {
      templateImage = await loadImage(templatePath);
    }
  } catch (error) {
    console.error(`[qrCodeGenerator] Failed to load template "${templatePath}": ${error.message}`);
    const defaultCanvas = createCanvas(400, 600);
    const defaultCtx = defaultCanvas.getContext('2d');

    defaultCtx.fillStyle = '#FFFFFF';
    defaultCtx.fillRect(0, 0, 400, 600);
    defaultCtx.fillStyle = '#F97316';
    defaultCtx.fillRect(0, 0, 400, 100);
    defaultCtx.fillStyle = '#FFFFFF';
    defaultCtx.font = 'bold 24px Arial';
    defaultCtx.textAlign = 'center';
    defaultCtx.fillText('SCAN ME', 200, 50);
    const companyName = process.env.BOT_NAME || 'KOALASTORE.DIGI';
    defaultCtx.fillText(companyName, 200, 80);

    templateImage = defaultCanvas;
  }

  // Pre-calculate QR position
  const finalQrX = qrX !== undefined && qrX !== null ? qrX : (templateImage.width - qrSize) / 2;
  const finalQrY = qrY !== undefined && qrY !== null ? qrY : (templateImage.height - qrSize) / 2;

  // Create main canvas and draw template
  const canvas = createCanvas(templateImage.width, templateImage.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(templateImage, 0, 0);

  // Generate QR code directly with border radius if needed
  if (borderRadius > 0) {
    // Create QR with border radius in one step
    const qrCanvas = createCanvas(qrSize, qrSize);
    const qrCtx = qrCanvas.getContext('2d');

    // Apply border radius clipping first
    const radius = qrSize * borderRadius;
    qrCtx.beginPath();
    qrCtx.moveTo(radius, 0);
    qrCtx.lineTo(qrSize - radius, 0);
    qrCtx.quadraticCurveTo(qrSize, 0, qrSize, radius);
    qrCtx.lineTo(qrSize, qrSize - radius);
    qrCtx.quadraticCurveTo(qrSize, qrSize, qrSize - radius, qrSize);
    qrCtx.lineTo(radius, qrSize);
    qrCtx.quadraticCurveTo(0, qrSize, 0, qrSize - radius);
    qrCtx.lineTo(0, radius);
    qrCtx.quadraticCurveTo(0, 0, radius, 0);
    qrCtx.closePath();
    qrCtx.clip();

    // Generate QR directly onto clipped canvas
    await QRCode.toCanvas(qrCanvas, qrisText, {
      width: qrSize,
      color: { dark: color, light: '#00000000' },
      margin: 1,
      errorCorrectionLevel: 'M'
    });

    // Draw QR on main canvas
    ctx.drawImage(qrCanvas, finalQrX, finalQrY);
  } else {
    // Generate QR directly at final position if no border radius
    const tempCanvas = createCanvas(qrSize, qrSize);
    await QRCode.toCanvas(tempCanvas, qrisText, {
      width: qrSize,
      color: { dark: color, light: '#00000000' },
      margin: 1,
      errorCorrectionLevel: 'M'
    });
    ctx.drawImage(tempCanvas, finalQrX, finalQrY);
  }

  // Return PNG buffer directly
  return canvas.toBuffer('image/png');
}

/**
 * Resolve a template value to a loadable path or URL.
 * - SINGLE mode: always local path (no R2 CDN conversion)
 * - MULTI mode: R2 key → CDN URL; full URLs and absolute/relative paths used as-is
 * @param {string|null} value
 * @returns {string|null}
 */
function resolveTemplatePath(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;            // already full URL
  if (value.startsWith('/') || value.startsWith('.')) return value; // absolute/relative local path
  if (modeService.isSingleMode()) return value;             // single mode: treat as local path as-is
  return `https://images.koalastore.digital/${value}`;      // multi mode: R2 key → CDN URL
}

/**
 * Generate QR code with template overlay using settings from database
 * @param {string} qrisText - QRIS content text
 * @param {Object} [customOptions={}] - Custom styling options to override database settings
 * @param {Object} [ctx=null] - Telegraf context (optional, for multi-mode support)
 * @returns {Promise<Buffer>} - PNG image buffer
 */
async function generateQRCodeWithTemplate(qrisText, customOptions = {}, ctx = null) {
  const settings = await settingsService.getSettings(ctx);

  const templatePath = resolveTemplatePath(settings?.qrisTemplate)
    || resolveTemplatePath(process.env.QRIS_TEMPLATE_PATH)
    || path.join(__dirname, '../../../img/qris-template.png');

  const options = {
    color: customOptions.color || settings?.qrisDotColor || '#d18324',
    qrSize: customOptions.qrSize || settings?.qrisSize || 230,
    qrX: customOptions.qrX !== undefined ? customOptions.qrX : (settings?.qrisX || 250),
    qrY: customOptions.qrY !== undefined ? customOptions.qrY : (settings?.qrisY || 133),
    borderRadius: customOptions.borderRadius !== undefined ? customOptions.borderRadius : (settings?.qrisBorderRadius || 0.1)
  };

  return await overlayQROnTemplate(qrisText, templatePath, options);
}

/**
 * Resolve whether QRIS overlay is enabled.
 * Reads from settings first (per-bot in multi-mode), falls back to QRIS_OVERLAY_ENABLED env var.
 * @param {Object} [ctx=null] - Telegraf context (optional, for multi-mode support)
 * @returns {Promise<boolean>}
 */
async function isQrisOverlayEnabled(ctx = null) {
  const settings = await settingsService.getSettings(ctx);
  const fromSettings = settings?.qrisTemplateEnabled;
  if (fromSettings !== null && fromSettings !== undefined) {
    return fromSettings;
  }
  return process.env.QRIS_OVERLAY_ENABLED === 'true';
}

/**
 * Overlay a pre-rendered QR image (Buffer) on a template image.
 * Used by gateways that return a QR image directly (e.g., Qrispy) instead of QR text.
 * @param {Buffer} qrImageBuffer - Pre-rendered QR image buffer (PNG/JPEG)
 * @param {string} templatePath - Path or URL to template image
 * @param {Object} [options={}] - Styling options
 * @param {number} [options.qrSize=320] - QR code display size in pixels
 * @param {number} [options.qrX] - X position (centered if not specified)
 * @param {number} [options.qrY=480] - Y position (centered if not specified)
 * @param {number} [options.borderRadius=0.1] - Border radius as percentage
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function overlayQRImageOnTemplate(qrImageBuffer, templatePath, options = {}) {
  const {
    qrSize = 320,
    qrX,
    qrY = 480,
    borderRadius = 0.1
  } = options;

  let templateImage;
  try {
    if (/^https?:\/\//i.test(templatePath)) {
      const response = await axios.get(templatePath, { responseType: 'arraybuffer', timeout: 10000 });
      templateImage = await loadImage(Buffer.from(response.data));
    } else {
      templateImage = await loadImage(templatePath);
    }
  } catch (error) {
    console.error(`[qrCodeGenerator] Failed to load template "${templatePath}": ${error.message}`);
    const defaultCanvas = createCanvas(400, 600);
    const defaultCtx = defaultCanvas.getContext('2d');
    defaultCtx.fillStyle = '#FFFFFF';
    defaultCtx.fillRect(0, 0, 400, 600);
    defaultCtx.fillStyle = '#F97316';
    defaultCtx.fillRect(0, 0, 400, 100);
    defaultCtx.fillStyle = '#FFFFFF';
    defaultCtx.font = 'bold 24px Arial';
    defaultCtx.textAlign = 'center';
    const companyName = process.env.BOT_NAME || 'KOALASTORE.DIGI';
    defaultCtx.fillText('SCAN ME', 200, 50);
    defaultCtx.fillText(companyName, 200, 80);
    templateImage = defaultCanvas;
  }

  const finalQrX = qrX !== undefined && qrX !== null ? qrX : (templateImage.width - qrSize) / 2;
  const finalQrY = qrY !== undefined && qrY !== null ? qrY : (templateImage.height - qrSize) / 2;

  const canvas = createCanvas(templateImage.width, templateImage.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(templateImage, 0, 0);

  const qrImage = await loadImage(qrImageBuffer);

  if (borderRadius > 0) {
    const radius = qrSize * borderRadius;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(finalQrX + radius, finalQrY);
    ctx.lineTo(finalQrX + qrSize - radius, finalQrY);
    ctx.quadraticCurveTo(finalQrX + qrSize, finalQrY, finalQrX + qrSize, finalQrY + radius);
    ctx.lineTo(finalQrX + qrSize, finalQrY + qrSize - radius);
    ctx.quadraticCurveTo(finalQrX + qrSize, finalQrY + qrSize, finalQrX + qrSize - radius, finalQrY + qrSize);
    ctx.lineTo(finalQrX + radius, finalQrY + qrSize);
    ctx.quadraticCurveTo(finalQrX, finalQrY + qrSize, finalQrX, finalQrY + qrSize - radius);
    ctx.lineTo(finalQrX, finalQrY + radius);
    ctx.quadraticCurveTo(finalQrX, finalQrY, finalQrX + radius, finalQrY);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(qrImage, finalQrX, finalQrY, qrSize, qrSize);
    ctx.restore();
  } else {
    ctx.drawImage(qrImage, finalQrX, finalQrY, qrSize, qrSize);
  }

  return canvas.toBuffer('image/png');
}

/**
 * Overlay a pre-rendered QR image on template using database settings.
 * Counterpart to generateQRCodeWithTemplate for gateways returning QR images.
 * @param {Buffer} qrImageBuffer - Pre-rendered QR image buffer
 * @param {Object} [customOptions={}] - Custom styling options
 * @param {Object} [ctx=null] - Telegraf context
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generateQRImageWithTemplate(qrImageBuffer, customOptions = {}, ctx = null) {
  const settings = await settingsService.getSettings(ctx);

  const templatePath = resolveTemplatePath(settings?.qrisTemplate)
    || resolveTemplatePath(process.env.QRIS_TEMPLATE_PATH)
    || path.join(__dirname, '../../../img/qris-template.png');

  const options = {
    qrSize: customOptions.qrSize || settings?.qrisSize || 230,
    qrX: customOptions.qrX !== undefined ? customOptions.qrX : (settings?.qrisX || 250),
    qrY: customOptions.qrY !== undefined ? customOptions.qrY : (settings?.qrisY || 133),
    borderRadius: customOptions.borderRadius !== undefined ? customOptions.borderRadius : (settings?.qrisBorderRadius || 0.1)
  };

  return await overlayQRImageOnTemplate(qrImageBuffer, templatePath, options);
}

module.exports = {
  overlayQROnTemplate,
  generateQRCodeWithTemplate,
  generateQRImageWithTemplate,
  overlayQRImageOnTemplate,
  isQrisOverlayEnabled,
};
