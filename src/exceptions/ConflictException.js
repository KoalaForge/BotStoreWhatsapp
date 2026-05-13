const ApiException = require('./ApiException');

/**
 * 409 Conflict Exception
 * Thrown when resource already exists or conflict occurs
 */
class ConflictException extends ApiException {
    constructor(message = 'Resource already exists') {
        super(message, 409);
    }
}

module.exports = ConflictException;
