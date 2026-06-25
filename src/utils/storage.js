// Strict 30-Item FIFO Client-Side Storage Manager using IndexedDB

const DB_NAME = "KhmerFontSandboxDB";
const STORE_NAME = "compiled_fonts";
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = function (e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                // Key path uses auto-increment ID, indexing by timestamp for sorting
                const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
                store.createIndex("timestamp", "timestamp", { unique: false });
            }
        };
        
        request.onsuccess = function (e) {
            resolve(e.target.result);
        };
        
        request.onerror = function (e) {
            reject(e.target.error);
        };
    });
}

/**
 * Saves a compiled font binary to IndexedDB.
 * Enforces the strict 30-item FIFO (First-In, First-Out) eviction policy.
 * @param {string} name - Name of the font family.
 * @param {ArrayBuffer} buffer - Compiled TTF binary data.
 * @param {object} metadata - Extra details (e.g. styleName, parameters used).
 */
export async function saveFont(name, buffer, metadata = {}) {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        
        const item = {
            name,
            fontBuffer: buffer,
            metadata,
            timestamp: Date.now()
        };
        
        const addRequest = store.add(item);
        
        addRequest.onsuccess = async function () {
            try {
                await enforceFIFOLimit(db);
                resolve(true);
            } catch (err) {
                reject(err);
            }
        };
        
        addRequest.onerror = function (e) {
            reject(e.target.error);
        };
    });
}

/**
 * Retrieves all stored fonts sorted by timestamp (newest first).
 */
export async function getAllFonts() {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("timestamp");
        const request = index.openCursor(null, "prev"); // newest first
        
        const fonts = [];
        request.onsuccess = function (e) {
            const cursor = e.target.result;
            if (cursor) {
                fonts.push(cursor.value);
                cursor.continue();
            } else {
                resolve(fonts);
            }
        };
        
        request.onerror = function (e) {
            reject(e.target.error);
        };
    });
}

/**
 * Deletes a specific font from IndexedDB.
 */
export async function deleteFont(id) {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        
        request.onsuccess = function () {
            resolve(true);
        };
        
        request.onerror = function (e) {
            reject(e.target.error);
        };
    });
}

/**
 * Enforces the strict 30-item limit. If the store contains more than 30 items,
 * it deletes the oldest entries (FIFO eviction).
 */
async function enforceFIFOLimit(db) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("timestamp");
        
        // Open cursor to list items from oldest to newest
        const request = index.openCursor(null, "next");
        const items = [];
        
        request.onsuccess = function (e) {
            const cursor = e.target.result;
            if (cursor) {
                items.push({ id: cursor.primaryKey, timestamp: cursor.key });
                cursor.continue();
            } else {
                // If count exceeds 30, evict oldest items
                if (items.length > 30) {
                    const toDeleteCount = items.length - 30;
                    console.log(`[Storage] Evicting ${toDeleteCount} oldest font(s) to enforce strict 30-item FIFO limit.`);
                    
                    let deletedCount = 0;
                    for (let i = 0; i < toDeleteCount; i++) {
                        const deleteReq = store.delete(items[i].id);
                        deleteReq.onsuccess = function () {
                            deletedCount++;
                            if (deletedCount === toDeleteCount) {
                                resolve();
                            }
                        };
                        deleteReq.onerror = function (err) {
                            reject(err.target.error);
                        };
                    }
                } else {
                    resolve();
                }
            }
        };
        
        request.onerror = function (e) {
            reject(e.target.error);
        };
    });
}
