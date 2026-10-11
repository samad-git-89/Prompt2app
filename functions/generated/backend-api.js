const express = require('express');
const app = express();
const functions = require('firebase-functions');

app.use(express.json());

app.get('/api/hello', (req, res) => {
    functions.logger.info('Hello API called!');
    res.send('Hello from the backend API!');
});

app.post('/api/action', (req, res) => {
    functions.logger.info('Action API called with data:', req.body);
    res.json({ message: `Action '${req.body.button}' received at ${req.body.timestamp}!`, receivedData: req.body });
});

exports.app = functions.https.onRequest(app);