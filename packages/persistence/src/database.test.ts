import { describe, it, expect, afterEach } from 'vitest';
import {
    getDatabase,
    closeDatabase,
    flushAll,
    RTCAgentDatabase,
    DB_NAME_PREFIX,
} from './database.js';

describe('database', () => {
    afterEach(async () => {
        await closeDatabase();
    });

    // ── DB_NAME_PREFIX ──

    describe('DB_NAME_PREFIX', () => {
        it('should be "rtc-agent-"', () => {
            expect(DB_NAME_PREFIX).toBe('rtc-agent-');
        });
    });

    // ── RTCAgentDatabase constructor ──

    describe('RTCAgentDatabase', () => {
        it('should accept a name starting with the prefix', () => {
            const db = new RTCAgentDatabase(`${DB_NAME_PREFIX}valid`);
            expect(db).toBeInstanceOf(RTCAgentDatabase);
            db.close();
        });

        it('should accept a custom name without the prefix', () => {
            const db = new RTCAgentDatabase('custom-name');
            expect(db).toBeInstanceOf(RTCAgentDatabase);
            db.close();
        });

        it('should throw for an empty name', () => {
            expect(() => new RTCAgentDatabase('')).toThrow(/must not be empty/);
        });
    });

    // ── getDatabase ──

    describe('getDatabase', () => {
        it('should throw when called without name and no instance exists', () => {
            expect(() => getDatabase()).toThrow(/called without a name/);
        });

        it('should return singleton instance after initialization', () => {
            const db1 = getDatabase(`${DB_NAME_PREFIX}test-singleton`);
            const db2 = getDatabase();
            expect(db1).toBe(db2);
        });

        it('should create new instance when name changes', () => {
            const db1 = getDatabase(`${DB_NAME_PREFIX}test-db-1`);
            const db2 = getDatabase(`${DB_NAME_PREFIX}test-db-2`);
            expect(db1).not.toBe(db2);
        });

        it('should throw for empty database name', () => {
            expect(() => getDatabase('')).toThrow(/must not be empty/);
        });

        it('should return same instance for same name', () => {
            const name = `${DB_NAME_PREFIX}test-same-name`;
            const db1 = getDatabase(name);
            const db2 = getDatabase(name);
            expect(db1).toBe(db2);
        });
    });

    // ── closeDatabase ──

    describe('closeDatabase', () => {
        it('should reset singleton so getDatabase() without name throws', async () => {
            getDatabase(`${DB_NAME_PREFIX}test-close`);
            await closeDatabase();
            expect(() => getDatabase()).toThrow();
        });

        it('should be safe to call when no instance exists', async () => {
            await expect(closeDatabase()).resolves.toBeUndefined();
        });
    });

    // ── flushAll ──

    describe('flushAll', () => {
        it('should clear all tables', async () => {
            const db = getDatabase(`${DB_NAME_PREFIX}test-flush`);

            // Insert data into each table
            await db.sessions.add({
                client_id: 's1',
                title: 'Test',
                created_at: '',
                updated_at: '',
                owner_ref_id: '',
                status: 'active',
                sync_status: 'synced',
                pending_turn_count: 0,
                running_turn_count: 0,
            } as any);

            await db.offsets.put({
                channel: 'ch1',
                offset: 100,
                epoch: 'e1',
                updatedAt: Date.now(),
            });

            // Verify data exists
            expect(await db.sessions.count()).toBe(1);
            expect(await db.offsets.count()).toBe(1);

            // Flush
            await flushAll();

            // Verify all cleared
            expect(await db.sessions.count()).toBe(0);
            expect(await db.offsets.count()).toBe(0);
        });
    });
});
