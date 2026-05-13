const mongoose = require('mongoose');
const clc = require("cli-color");
const moment = require('moment-timezone');

const db = mongoose.connection;

async function connectDatabase() {
    try {
        await mongoose.connect(process.env.DATABASE_MONGODB_URI, {
            dbName: process.env.DATABASE_NAME,
            maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 50,
            minPoolSize: 5,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
        });
    } catch (error) {
        console.clear()
        console.log("MongoDB connection error:", error);
        process.exit()

    }
}

db.once("connected", () => {
    console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(" Success connect to database"));
});

module.exports = connectDatabase;