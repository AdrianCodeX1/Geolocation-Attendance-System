const { authenticator } = require('otplib');
const config = require('../config');

// Dedicated instance so we don't mutate otplib's global defaults.
const totp = authenticator.clone({
  step: config.totp.step,
  window: config.totp.window,
  digits: 6,
});

module.exports = {
  generateSecret: () => totp.generateSecret(),
  generate: (secret) => totp.generate(secret),
  check: (code, secret) => {
    try {
      return totp.check(String(code), secret);
    } catch {
      return false;
    }
  },
  secondsRemaining: () => totp.timeRemaining(),
  step: config.totp.step,
};
