const fp = require('fastify-plugin');

/**
 * Global error handler middleware
 */
async function errorHandlerPlugin(fastify, options) {
    fastify.setErrorHandler((error, request, reply) => {
        // Log error
        console.error(`[API ERROR] ${error.message}`);

        // Validation error
        if (error.validation) {
            return reply.code(400).send({
                success: false,
                code: 400,
                message: 'Validation error',
                data: {
                    errors: error.validation
                }
            });
        }

        // Custom application errors
        const statusCode = error.statusCode || 500;

        // For 500 errors: sanitize to prevent leaking internal details
        // For known errors (4xx with statusCode set): use original message
        let message;
        if (statusCode >= 500) {
            const { sanitizeErrorMessage } = require('../../utils/errorSanitizer');
            message = sanitizeErrorMessage(error);
        } else {
            message = error.message || 'Internal server error';
        }

        return reply.code(statusCode).send({
            success: false,
            code: statusCode,
            message: message,
            data: null
        });
    });
}

module.exports = fp(errorHandlerPlugin);
