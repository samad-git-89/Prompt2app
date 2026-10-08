const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

admin.initializeApp();
const db = admin.firestore();
const app = express();

// Automatically allow cross-origin requests
app.use(cors({ origin: true }));
app.use(express.json());

// --- API Endpoints for Reading List Entries ---

// Create a new reading list entry
app.post('/entries', async (req, res) => {
    try {
        const { title, author, status, notes } = req.body;
        if (!title || !author || !status) {
            return res.status(400).send({ message: 'Title, author, and status are required.' });
        }
        const newEntry = {
            title,
            author,
            status,
            notes: notes || '',
            dateAdded: new Date().toISOString(),
        };
        const docRef = await db.collection('readingListEntries').add(newEntry);
        res.status(201).send({ id: docRef.id, ...newEntry });
    } catch (error) {
        console.error('Error creating entry:', error);
        res.status(500).send({ message: 'Error creating entry', error: error.message });
    }
});

// Get all reading list entries
app.get('/entries', async (req, res) => {
    try {
        const snapshot = await db.collection('readingListEntries').orderBy('dateAdded', 'desc').get();
        const entries = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        res.status(200).send(entries);
    } catch (error) {
        console.error('Error getting entries:', error);
        res.status(500).send({ message: 'Error getting entries', error: error.message });
    }
});

// Get a single reading list entry by ID
app.get('/entries/:id', async (req, res) => {
    try {
        const doc = await db.collection('readingListEntries').doc(req.params.id).get();
        if (!doc.exists) {
            return res.status(404).send({ message: 'Entry not found' });
        }
        res.status(200).send({ id: doc.id, ...doc.data() });
    } catch (error) {
        console.error('Error getting entry:', error);
        res.status(500).send({ message: 'Error getting entry', error: error.message });
    }
});

// Update a reading list entry by ID
app.put('/entries/:id', async (req, res) => {
    try {
        const { title, author, status, notes } = req.body;
        if (!title || !author || !status) {
            return res.status(400).send({ message: 'Title, author, and status are required.' });
        }
        const updatedEntry = {
            title,
            author,
            status,
            notes: notes || '',
        };
        await db.collection('readingListEntries').doc(req.params.id).update(updatedEntry);
        res.status(200).send({ id: req.params.id, ...updatedEntry });
    } catch (error) {
        console.error('Error updating entry:', error);
        res.status(500).send({ message: 'Error updating entry', error: error.message });
    }
});

// Delete a reading list entry by ID
app.delete('/entries/:id', async (req, res) => {
    try {
        await db.collection('readingListEntries').doc(req.params.id).delete();
        res.status(204).send(); // No Content
    } catch (error) {
        console.error('Error deleting entry:', error);
        res.status(500).send({ message: 'Error deleting entry', error: error.message });
    }
});

// Expose the API as a Firebase Cloud Function
exports.api = functions.https.onRequest(app);
