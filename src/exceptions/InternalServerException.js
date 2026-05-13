const ApiException = require('./ApiException');

/**
 * 500 Internal Server Error Exception
 * Thrown when unexpected server error occurs
 */
class InternalServerException extends ApiException {
    constructor(message = 'Internal Server Error') {
        super(message, 500);
    }
}

module.exports = InternalServerException;
