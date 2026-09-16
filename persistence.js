const DATABASE_NAME = "vibe-up";
const DATABASE_VERSION = 3;
const STORE_NAME = "workspace";
const DOCUMENT_KEY = "autosave";
const RECOVERY_STORE = "recovery";

const openDatabase = () => new Promise((resolve, reject) => {
  if (!("indexedDB" in globalThis)) {
    resolve(null);
    return;
  }
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME);
    }
    if (!database.objectStoreNames.contains(RECOVERY_STORE)) {
      database.createObjectStore(RECOVERY_STORE, { keyPath: "id" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("Could not open local storage."));
});

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("Local storage request failed."));
});

const transactionComplete = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error ?? new Error("Local storage transaction failed."));
  transaction.onabort = () => reject(transaction.error ?? new Error("Local storage transaction was aborted."));
});

export const loadWorkspace = async () => {
  const database = await openDatabase();
  if (!database) {
    return null;
  }
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    return await requestResult(transaction.objectStore(STORE_NAME).get(DOCUMENT_KEY));
  } finally {
    database.close();
  }
};

export const loadRecovery = async () => {
  const database = await openDatabase();
  if (!database) {
    return null;
  }
  try {
    const transaction = database.transaction(RECOVERY_STORE, "readonly");
    const records = await requestResult(transaction.objectStore(RECOVERY_STORE).getAll());
    await transactionComplete(transaction);
    return records.reduce((latest, record) => (!latest || String(record.savedAt) > String(latest.savedAt) ? record : latest), null);
  } finally {
    database.close();
  }
};

export const clearRecovery = async () => {
  const database = await openDatabase();
  if (!database) {
    return;
  }
  try {
    const transaction = database.transaction(RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECOVERY_STORE).clear();
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
};

export const saveWorkspace = async (workspace) => {
  const database = await openDatabase();
  if (!database) {
    return;
  }
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(workspace, DOCUMENT_KEY);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
};

export const saveRecovery = async (workspace) => {
  const database = await openDatabase();
  if (!database) {
    return;
  }
  try {
    const transaction = database.transaction(RECOVERY_STORE, "readwrite");
    transaction.objectStore(RECOVERY_STORE).put({
      ...workspace,
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
};
