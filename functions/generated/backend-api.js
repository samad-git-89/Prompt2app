const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: "https://effective-space-orbit-jj4q4pwgw9wrf4gq-5000.app.github.dev",
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.get('/api/hello', (req, res) => {
    functions.logger.info('Hello API called!');
    res.status(200).json({ message: 'Hello from the backend API!' });
});

exports.app = functions.https.onRequest(app);