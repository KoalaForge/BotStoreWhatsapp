const {default: PQueue} = require('p-queue');

const broadcastQueue = new PQueue({concurrency: 5});

module.exports = {
    broadcastQueue,
}