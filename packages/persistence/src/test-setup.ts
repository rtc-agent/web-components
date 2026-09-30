// Persistence test setup — Node environment with IndexedDB polyfill.
// Dexie (our IndexedDB wrapper) requires a real IndexedDB implementation.
import 'fake-indexeddb/auto';

// Disable persistent UI update queue by default in tests to avoid IndexedDB write overhead.
// Individual tests that specifically test the persistence feature can re-enable it.
import { UIUpdateBus } from './ui-update-bus.js';
UIUpdateBus.persistEnabled = false;
