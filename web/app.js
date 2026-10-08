// Firebase Config (placeholder)
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const addBookForm = document.getElementById('addBookForm');
const bookTitleInput = document.getElementById('bookTitle');
const readingList = document.getElementById('readingList');

// Function to add a new book
addBookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = bookTitleInput.value.trim();
    if (title) {
        try {
            await db.collection('books').add({
                title: title,
                read: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp() // Optional: for ordering
            });
            bookTitleInput.value = ''; // Clear input
        } catch (error) {
            console.error("Error adding document: ", error);
        }
    }
});

// Function to toggle read status
readingList.addEventListener('click', async (e) => {
    if (e.target.classList.contains('toggle-read')) {
        const bookId = e.target.dataset.id;
        const currentReadStatus = e.target.dataset.read === 'true';
        try {
            await db.collection('books').doc(bookId).update({
                read: !currentReadStatus
            });
        } catch (error) {
            console.error("Error updating document: ", error);
        }
    }
});

// Real-time listener for books
db.collection('books').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
    readingList.innerHTML = ''; // Clear current list
    snapshot.forEach((doc) => {
        const book = doc.data();
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${book.title}</span>
            <button class="toggle-read" data-id="${doc.id}" data-read="${book.read}">
                ${book.read ? 'Mark Unread' : 'Mark Read'}
            </button>
        `;
        if (book.read) {
            li.classList.add('read');
        }
        readingList.appendChild(li);
    });
});