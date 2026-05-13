# Payment Gateway System

This directory contains the payment gateway abstraction layer for the Telegram bot.

## Quick Start

Use `qrisService` to interact with payment gateways:

```javascript
const qrisService = require('../qrisService');

// Generate QRIS for product purchase
const result = await qrisService.generateProductQRIS({
  ctx,
  totalAmount: 10000,
  orderAmount: 1,
  price: 10000,
  productName: 'Product Name',
  gateway: 'linkqu' // optional, uses default if not specified
});

// Check payment status
const status = await qrisService.checkPaymentStatus({
  referenceId: 'TRX123456',
  amount: 10000,
  gateway: 'linkqu' // optional
});
```

## Directory Structure

- **`gateways/`** - Payment gateway implementations
  - `BasePaymentGateway.js` - Abstract base class for all gateways
  - `LinkQuGateway.js` - LinkQu payment gateway
  - `TokopayGateway.js` - TokoPay payment gateway

- **`utils/`** - Shared utilities
  - `qrCodeGenerator.js` - QR code generation with template overlay

- **`PaymentGatewayFactory.js`** - Factory for creating gateway instances

## Available Gateways

- **linkqu** - LinkQu Payment Gateway (default)
- **tokopay** - TokoPay Payment Gateway

## Configuration

Set the default gateway in `.env`:

```bash
DEFAULT_PAYMENT_GATEWAY=linkqu  # or 'tokopay'
```

## Adding a New Gateway

1. Create a new class extending `BasePaymentGateway`
2. Implement required methods: `validateConfig()`, `createQRIS()`, `checkPaymentStatus()`
3. Register in `PaymentGatewayFactory._initializeGateways()`
4. Add environment variables to `.env`

## Full Documentation

See `/docs/PAYMENT_GATEWAY_SYSTEM.md` for complete documentation.
