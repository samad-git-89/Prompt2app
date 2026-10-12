const express = require('express');
const app = express();

app.use(express.json());

app.get('/api/data', (req, res) => {
    console.log('GET /api/data received');
    res.status(200).json({
        message: 'Hello from the backend API!',
        timestamp: new Date().toISOString(),
        data: {
            userCount: 123,
            items: ['item1', 'item2', 'item3']
        }
    });
});

app.post('/api/submit', (req, res) => {
    console.log('POST /api/submit received', req.body);
    const { payload } = req.body;
    if (payload) {
        res.status(200).json({
            status: 'success',
            receivedPayload: payload,
            processedAt: new Date().toISOString()
        });
    } else {
        res.status(400).json({
            status: 'error',
            message: 'Payload is required'
        });
    }
});

module.exports = app;