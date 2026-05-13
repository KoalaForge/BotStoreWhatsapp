const ApiException = require('./ApiException');

/**
 * 404 Not Found Exception
 * Thrown when requested resource does not exist
 */
class NotFoundException extends ApiException {
    constructor(message = 'Resource not found') {
        super(message, 404);
    }
}

module.exports = NotFoundException;
