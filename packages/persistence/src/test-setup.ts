// Persistence test setup — Node environment with IndexedDB polyfill.
// Dexie (our IndexedDB wrapper) requires a real IndexedDB implementation.
import 'fake-indexeddb/auto';
