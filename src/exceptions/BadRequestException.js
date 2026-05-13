const ApiException = require('./ApiException');

/**
 * 400 Bad Request Exception
 * Thrown when client sends invalid input or validation fails
 */
class BadRequestException extends ApiException {
    constructor(message = 'Bad Request') {
        super(message, 400);
    }
}

module.exports = BadRequestException;
