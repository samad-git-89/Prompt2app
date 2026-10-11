const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({ origin: true }));

app.get('/api/hello', (req, res) => {
    functions.logger.info('Hello API called!');
    res.status(200).json({ message: 'Hello from the backend API!' });
});

exports.app = functions.https.onRequest(app);