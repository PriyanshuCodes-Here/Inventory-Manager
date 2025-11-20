import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, addDoc, updateDoc, deleteDoc, onSnapshot, collection, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables and Configuration (The Core Setup) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let app, db, auth, userId;
// Renamed collection for a more personal touch
const ITEM_COLLECTION = 'my_shop_stock'; 
let isAuthReady = false;
// Renamed threshold for better clarity
const REORDER_POINT = 5; 

// --- DOM Elements ---
const inventoryList = document.getElementById('inventory-list');
const addItemBtn = document.getElementById('add-item-btn');
const loadingMessage = document.getElementById('loading-message');
const emptyState = document.getElementById('empty-state');
const authStatus = document.getElementById('auth-status');
const userIdDisplay = document.getElementById('user-id-display');

const modal = document.getElementById('crud-modal');
const modalContent = document.getElementById('modal-content');
const modalTitle = document.getElementById('modal-title');
const productForm = document.getElementById('product-form');
const productIdInput = document.getElementById('product-id');
const productNameInput = document.getElementById('product-name');
const productQuantityInput = document.getElementById('product-quantity');
const productPriceInput = document.getElementById('product-price');
const submitBtn = document.getElementById('submit-btn');
const cancelBtn = document.getElementById('cancel-btn');


/**
 * Simple helper to map Firestore document data.
 */
const mapDocToProduct = (docSnapshot) => ({
    id: docSnapshot.id,
    ...docSnapshot.data()
});

// --- Database Connection Setup (Initialization & Authentication) ---

const connectToFireStore = async () => {
    try {
        if (Object.keys(firebaseConfig).length === 0) {
             authStatus.textContent = 'Error: Firebase config missing.';
             throw new Error('Firebase configuration is empty.');
        }

        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        authStatus.textContent = 'Database Status: Connecting...';
        
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }

        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                isAuthReady = true;
                authStatus.textContent = 'Database Status: Ready (Authenticated)';
                userIdDisplay.textContent = `User ID: ${userId}`;
                addItemBtn.disabled = false;
                
                // Start watching for real-time changes
                watchForStockChanges();
            } else {
                isAuthReady = true;
                userId = null;
                authStatus.textContent = 'Database Status: Connection Failed';
                userIdDisplay.textContent = 'Please refresh to try again.';
                addItemBtn.disabled = true;
                loadingMessage.textContent = 'Authentication required to load inventory.';
            }
        });

    } catch (error) {
        console.error("Database connection failed:", error);
        authStatus.textContent = `Error: ${error.message}`;
        loadingMessage.textContent = 'Failed to load application. Check console for details.';
    }
};

// --- CRUD Operations ---

/**
 * CREATE / UPDATE: Handles form submission for adding a new item or tweaking an existing one.
 */
productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isAuthReady || !userId) return;

    const id = productIdInput.value;
    const name = productNameInput.value.trim();
    const quantity = parseInt(productQuantityInput.value, 10);
    // Ensure price is stored as a string with 2 decimal places
    const price = parseFloat(productPriceInput.value).toFixed(2);
    
    if (!name || isNaN(quantity) || isNaN(price) || quantity < 0 || price <= 0) {
        displayNotification('Please enter valid data for all fields (Price must be > $0.00).', 'error');
        return;
    }

    try {
        const productData = {
            name,
            quantity,
            price: price, 
            updatedAt: Date.now(),
            ownerId: userId 
        };

        const collectionPath = `/artifacts/${appId}/public/data/${ITEM_COLLECTION}`;
        
        if (id) {
            // Update Operation
            const productDocRef = doc(db, collectionPath, id);
            await updateDoc(productDocRef, productData);
            displayNotification(`Stock for "${name}" updated successfully.`, 'info');
        } else {
            // Create Operation
            await addDoc(collection(db, collectionPath), {
                ...productData,
                createdAt: Date.now()
            });
            displayNotification(`New item "${name}" registered.`, 'info');
        }

        closeModal();
    } catch (error) {
        console.error("Error saving document: ", error);
        displayNotification('Failed to save product details.', 'error');
    }
});

/**
 * UPDATE: Changes the stock count instantly when using the In/Out buttons.
 */
const changeStockLevel = async (id, delta, currentQuantity) => {
    if (!isAuthReady || !userId) return;

    const newQuantity = currentQuantity + delta;

    if (newQuantity < 0) {
        displayNotification('Stock cannot go below zero!', 'error');
        return;
    }

    try {
        const productDocRef = doc(db, `/artifacts/${appId}/public/data/${ITEM_COLLECTION}`, id);
        await updateDoc(productDocRef, {
            quantity: newQuantity,
            updatedAt: Date.now()
        });
    } catch (error) {
        console.error("Error adjusting stock: ", error);
        displayNotification('Failed to adjust stock count.', 'error');
    }
};

/**
 * DELETE: Removes an item from the inventory.
 */
const permanentlyDeleteItem = async (id, name) => {
    if (!isAuthReady || !userId) return;
    
    // Simple confirmation logic (Replaces alert/confirm)
    if (!confirm(`Are you absolutely sure you want to permanently remove "${name}" from stock?`)) return; 

    try {
        const productDocRef = doc(db, `/artifacts/${appId}/public/data/${ITEM_COLLECTION}`, id);
        await deleteDoc(productDocRef);
        displayNotification(`Product "${name}" has been removed.`, 'info');
    } catch (error) {
        console.error("Error deleting document: ", error);
        displayNotification('Failed to delete product.', 'error');
    }
};

// --- Modal & UI Management ---

addItemBtn.addEventListener('click', () => openModal());
cancelBtn.addEventListener('click', closeModal);

function openModal(product = null) {
    if (product) {
        // Edit mode
        modalTitle.textContent = 'Tweak Details';
        productIdInput.value = product.id;
        productNameInput.value = product.name;
        productQuantityInput.value = product.quantity;
        productPriceInput.value = parseFloat(product.price).toFixed(2);
        submitBtn.textContent = 'Update Item';
        submitBtn.classList.replace('bg-indigo-600', 'bg-blue-600');
        submitBtn.classList.replace('hover:bg-indigo-700', 'hover:bg-blue-700');

    } else {
        // Create mode
        modalTitle.textContent = 'Register New Product';
        productForm.reset();
        productIdInput.value = '';
        submitBtn.textContent = 'Save Item';
        submitBtn.classList.replace('bg-blue-600', 'bg-indigo-600');
        submitBtn.classList.replace('hover:bg-blue-700', 'hover:bg-indigo-700');
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    // Animate in
    setTimeout(() => {
        modalContent.classList.remove('scale-95', 'opacity-0');
    }, 10);
}

function closeModal() {
    modalContent.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
    }, 300);
}

// --- UI Rendering (Read) ---

/**
 * Renders the list of products based on the current data.
 */
const renderProducts = (products) => {
    inventoryList.innerHTML = '';
    
    // Sort by quantity (lowest stock first for attention)
    const sortedProducts = products.sort((a, b) => a.quantity - b.quantity);

    if (sortedProducts.length === 0) {
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
    }

    sortedProducts.forEach(product => {
        const isLowStock = product.quantity <= REORDER_POINT;
        const statusColor = isLowStock ? 'bg-red-500' : (product.quantity > 0 ? 'bg-green-500' : 'bg-gray-400');
        const statusText = isLowStock ? 'CRITICAL' : (product.quantity > 0 ? 'In Stock' : 'Out of Stock');
        const cardBorder = isLowStock ? 'border-red-400 shadow-lg ring-2 ring-red-100' : 'border-gray-200';

        const productCard = document.createElement('div');
        productCard.className = `card bg-white p-5 rounded-xl border-t-8 ${cardBorder} flex flex-col`;
        
        productCard.innerHTML = `
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-xl font-semibold text-gray-900 truncate">${product.name}</h3>
                <span class="text-xs font-bold text-white px-3 py-1 rounded-full ${statusColor}">${statusText}</span>
            </div>

            <div class="space-y-2 mb-4">
                <p class="text-gray-600 text-sm">Unit Price: <span class="font-bold text-lg text-indigo-600">$${parseFloat(product.price).toFixed(2)}</span></p>
                <p class="text-gray-600 text-sm">Total Stock: <span class="font-bold text-2xl ${isLowStock ? 'text-red-600' : 'text-green-600'}">${product.quantity}</span> units</p>
            </div>

            <!-- Stock Control (Update - Interactive) -->
            <div class="flex gap-2 mb-4">
                <button data-id="${product.id}" data-action="decrease" class="stock-control-btn flex-1 bg-yellow-100 text-yellow-800 p-2 rounded-lg font-medium hover:bg-yellow-200" ${product.quantity <= 0 ? 'disabled' : ''}>
                    <svg class="w-5 h-5 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    Stock Out
                </button>
                <button data-id="${product.id}" data-action="increase" class="stock-control-btn flex-1 bg-indigo-100 text-indigo-800 p-2 rounded-lg font-medium hover:bg-indigo-200">
                    <svg class="w-5 h-5 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    Stock In
                </button>
            </div>

            <!-- Action Buttons (Update & Delete) -->
            <div class="flex gap-2 mt-auto">
                <button data-id="${product.id}" data-name="${product.name}" class="edit-btn flex-1 bg-blue-500 text-white p-2 rounded-xl font-semibold hover:bg-blue-600 transition duration-150 shadow-md">
                    Tweak Details
                </button>
                <button data-id="${product.id}" data-name="${product.name}" class="delete-btn bg-red-100 text-red-600 p-2 rounded-xl font-semibold hover:bg-red-200 transition duration-150">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </div>
        `;

        // Attach event listeners for dynamic interactions
        productCard.querySelector('.edit-btn').onclick = () => openModal(product);
        productCard.querySelector('.delete-btn').onclick = () => permanentlyDeleteItem(product.id, product.name);

        // Stock control listeners
        productCard.querySelectorAll('.stock-control-btn').forEach(button => {
            button.onclick = (e) => {
                const delta = e.currentTarget.dataset.action === 'increase' ? 1 : -1;
                changeStockLevel(product.id, delta, product.quantity);
            };
        });

        inventoryList.appendChild(productCard);
    });
    loadingMessage.classList.add('hidden');
};

/**
 * READ: Sets up the real-time listener to keep the UI in sync with the database.
 */
const watchForStockChanges = () => {
    if (!db || !isAuthReady || !userId) return;

    try {
        const productsCollectionRef = collection(db, `/artifacts/${appId}/public/data/${ITEM_COLLECTION}`);
        const q = query(productsCollectionRef);

        // Use onSnapshot for real-time updates (Read/Retrieve)
        onSnapshot(q, (snapshot) => {
            const products = [];
            snapshot.forEach(doc => {
                products.push(mapDocToProduct(doc));
            });
            renderProducts(products);
        }, (error) => {
            console.error("Error listening to Firestore: ", error);
            loadingMessage.textContent = 'Failed to load inventory data in real-time.';
            displayNotification('A connection error occurred with the database.', 'error');
        });

    } catch (error) {
        console.error("Error setting up real-time listener:", error);
        loadingMessage.textContent = 'Failed to initialize database listener.';
    }
};

// --- Custom Notification & Confirmation (Replaces native alerts) ---
function displayNotification(message, type = 'info') {
    let existingAlert = document.getElementById('custom-alert');
    if (existingAlert) existingAlert.remove();

    const colors = {
        'error': {bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-400'},
        'info': {bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-400'}
    };
    const color = colors[type] || colors['info'];

    const alertDiv = document.createElement('div');
    alertDiv.id = 'custom-alert';
    alertDiv.className = `fixed top-4 right-4 z-50 p-4 rounded-xl shadow-lg border-l-4 ${color.bg} ${color.text} ${color.border} max-w-sm transition-all duration-300 transform translate-x-full opacity-0`;
    alertDiv.innerHTML = `
        <div class="flex items-center">
            <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${type === 'error' ? 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z' : 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'}"></path></svg>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(alertDiv);

    // Show animation
    setTimeout(() => {
        alertDiv.classList.remove('translate-x-full', 'opacity-0');
    }, 10);

    // Hide after 5 seconds
    setTimeout(() => {
        alertDiv.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => alertDiv.remove(), 300);
    }, 5000);
}

// Simple replacement for window.confirm
function confirm(message) {
    // NOTE: A real UI modal would be better, but this uses window.prompt as a simple stand-in.
    return window.prompt(message + ' (Type "yes" to confirm)')?.toLowerCase() === 'yes';
}

// Initialize the application
connectToFireStore();