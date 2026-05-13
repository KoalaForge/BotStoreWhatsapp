/**
 * Base API Exception
 * All API exceptions extend this class
 */
class ApiException extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = ApiException;
