(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WorkspaceSyncCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    const VOCAB_LIST_ID = 'workspace-vocabulary-v1';
    const BUCKETS = 128;
    const MAX_DOCUMENT_BYTES = 700000;
    const encode = value => new TextEncoder().encode(JSON.stringify(value)).length;
    const hash = value => {
        let result = 2166136261;
        for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619) >>> 0;
        return (result % BUCKETS).toString(36).padStart(2, '0');
    };
    const vocabularyEntryId = word => {
        let value = 0xcbf29ce484222325n;
        for (const byte of new TextEncoder().encode(word)) value = BigInt.asUintN(64, (value ^ BigInt(byte)) * 0x100000001b3n);
        return `vocab-${value.toString(16).padStart(16, '0')}`;
    };
    const empty = () => ({ schemaVersion: 1, lists: [], deleted: { lists: [], entries: [] }, selected: '' });
    const timestamp = value => Number.isFinite(value) ? value : 0;
    const newer = (a, b, key) => timestamp(a?.[key]) >= timestamp(b?.[key]) ? a : b;
    const canonical = value => {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
        return value;
    };
    const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
    // Snapshot field order is produced by this app; avoid sorting every field of large imports.
    const sameSnapshot = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    function ensureVocabularyList(snapshot, now = Date.now()) {
        if (!Array.isArray(snapshot.lists)) snapshot.lists = [];
        if (!snapshot.deleted) snapshot.deleted = { lists: [], entries: [] };
        if (!Array.isArray(snapshot.deleted.lists)) snapshot.deleted.lists = [];
        if (!Array.isArray(snapshot.deleted.entries)) snapshot.deleted.entries = [];
        let changed = false;
        let list = snapshot.lists.find(item => item.id === VOCAB_LIST_ID);
        if (!list) {
            list = { id: VOCAB_LIST_ID, kind: 'vocabulary', name: '生词表', position: -1,
                createdAt: now, nameUpdatedAt: 0, updatedAt: now, entries: [] };
            snapshot.lists.unshift(list);
            changed = true;
        } else {
            if (list.kind !== 'vocabulary') { list.kind = 'vocabulary'; changed = true; }
            if (list.position !== -1) { list.position = -1; changed = true; }
            if (!list.name) { list.name = '生词表'; changed = true; }
        }
        const deletions = snapshot.deleted.lists.filter(item => item.listId !== VOCAB_LIST_ID);
        if (deletions.length !== snapshot.deleted.lists.length) { snapshot.deleted.lists = deletions; changed = true; }
        if (!snapshot.lists.some(item => item.id === snapshot.selected)) {
            snapshot.selected = snapshot.lists.find(item => item.id !== VOCAB_LIST_ID)?.id || VOCAB_LIST_ID;
            changed = true;
        }
        return { list, changed };
    }

    function pack(snapshot) {
        const lists = new Map();
        const buckets = new Map();
        for (const [listIndex, list] of (snapshot?.lists || []).entries()) {
            if (!list?.id || !Array.isArray(list.entries)) continue;
            lists.set(list.id, { id: list.id, name: list.name,
                nameUpdatedAt: list.id === VOCAB_LIST_ID ? timestamp(list.nameUpdatedAt) : timestamp(list.nameUpdatedAt || list.updatedAt),
                createdAt: timestamp(list.createdAt || list.updatedAt), position: list.position ?? listIndex,
                ...(list.id === VOCAB_LIST_ID ? { kind: 'vocabulary' } : {}), deletedAt: 0 });
            list.entries.forEach((entry, index) => {
                if (!entry?.id) return;
                const id = `${list.id}~${hash(entry.id)}`;
                if (!buckets.has(id)) buckets.set(id, { listId: list.id, records: Object.create(null) });
                buckets.get(id).records[entry.id] = { ...entry, order: entry.order ?? index };
            });
        }
        for (const item of snapshot?.deleted?.lists || []) {
            if (!item?.listId || item.listId === VOCAB_LIST_ID) continue;
            const prior = lists.get(item.listId);
            lists.set(item.listId, { ...(prior || { id: item.listId, name: '', nameUpdatedAt: 0, createdAt: 0, position: 0 }),
                deletedAt: Math.max(timestamp(prior?.deletedAt), timestamp(item.deletedAt)) });
        }
        for (const item of snapshot?.deleted?.entries || []) {
            if (!item?.listId || !item?.entryId) continue;
            const id = `${item.listId}~${hash(item.entryId)}`;
            if (!buckets.has(id)) buckets.set(id, { listId: item.listId, records: Object.create(null) });
            const prior = buckets.get(id).records[item.entryId];
            if (item.listId === VOCAB_LIST_ID && prior?.word && timestamp(prior.savedAt || prior.createdAt) > timestamp(item.deletedAt)) continue;
            buckets.get(id).records[item.entryId] = { ...(prior || { id: item.entryId }),
                deletedAt: Math.max(timestamp(prior?.deletedAt), timestamp(item.deletedAt)) };
        }
        for (const [id, data] of buckets) {
            if (encode(data) > MAX_DOCUMENT_BYTES) throw new Error(`词表 ${data.listId} 的分片 ${id} 过大，无法安全上传`);
        }
        return { lists, buckets };
    }

    function mergeList(a, b) {
        if (!a) return b?.id === VOCAB_LIST_ID ? { ...b, kind: 'vocabulary', deletedAt: 0 } : b;
        if (!b) return a.id === VOCAB_LIST_ID ? { ...a, kind: 'vocabulary', deletedAt: 0 } : a;
        const winner = newer(a, b, 'nameUpdatedAt');
        const firstCreated = timestamp(a.createdAt) || Infinity;
        const secondCreated = timestamp(b.createdAt) || Infinity;
        return { ...winner, ...(winner.id === VOCAB_LIST_ID ? { kind: 'vocabulary' } : {}),
            deletedAt: winner.id === VOCAB_LIST_ID ? 0 : Math.max(timestamp(a.deletedAt), timestamp(b.deletedAt)),
            createdAt: Math.min(firstCreated, secondCreated) === Infinity ? 0 : Math.min(firstCreated, secondCreated),
            position: Math.min(a.position ?? Infinity, b.position ?? Infinity) === Infinity
                ? 0 : Math.min(a.position ?? Infinity, b.position ?? Infinity) };
    }

    function mergeBucket(a, b) {
        if (!a) return b;
        if (!b) return a;
        const records = Object.assign(Object.create(null), a.records);
        for (const [id, incoming] of Object.entries(b.records || {})) {
            const prior = records[id];
            if (!prior) { records[id] = incoming; continue; }
            const latestDeletion = Math.max(timestamp(prior.deletedAt), timestamp(incoming.deletedAt));
            const special = (a.listId || b.listId) === VOCAB_LIST_ID;
            const active = special ? [prior, incoming].filter(record => record.word &&
                (!latestDeletion || timestamp(record.savedAt || record.createdAt) > latestDeletion)) : [];
            const winner = active.length ? active.reduce((best, record) => newer(best, record, 'updatedAt'))
                : newer(prior, incoming, 'updatedAt');
            const merged = { ...winner, deletedAt: special && active.length ? 0 : latestDeletion };
            if (special && !merged.deletedAt) {
                const sources = new Map();
                for (const source of active.flatMap(record => Array.isArray(record.sources) ? record.sources : [])) {
                    if (!source || typeof source !== 'object') continue;
                    const key = source.listId ? `list:${source.listId}` : `other:${source.listName}`;
                    const earlier = sources.get(key);
                    if (!earlier || timestamp(source.addedAt) < timestamp(earlier.addedAt)) sources.set(key, source);
                }
                merged.sources = [...sources.values()];
                merged.savedAt = Math.min(...active.map(record => timestamp(record.savedAt || record.createdAt) || Infinity));
                if (!Number.isFinite(merged.savedAt)) delete merged.savedAt;
            }
            records[id] = merged;
        }
        return { listId: a.listId || b.listId, records };
    }

    function mergePacked(a, b) {
        const lists = new Map(a.lists);
        const buckets = new Map(a.buckets);
        for (const [id, value] of b.lists) lists.set(id, mergeList(lists.get(id), value));
        for (const [id, value] of b.buckets) buckets.set(id, mergeBucket(buckets.get(id), value));
        return { lists, buckets };
    }

    function unpack(packed, selected = '') {
        const result = empty();
        const byId = new Map();
        for (const list of packed.lists.values()) {
            if (timestamp(list.deletedAt) && list.id !== VOCAB_LIST_ID) {
                result.deleted.lists.push({ listId: list.id, deletedAt: list.deletedAt });
                continue;
            }
            const value = { id: list.id, name: list.name || (list.id === VOCAB_LIST_ID ? '生词表' : '未命名词表'), createdAt: list.createdAt || 0,
                nameUpdatedAt: list.nameUpdatedAt || 0, updatedAt: list.nameUpdatedAt || 0,
                position: list.position ?? 0, ...(list.id === VOCAB_LIST_ID ? { kind: 'vocabulary' } : {}), entries: [] };
            result.lists.push(value);
            byId.set(list.id, value);
        }
        for (const bucket of packed.buckets.values()) {
            for (const entry of Object.values(bucket.records || {})) {
                if (timestamp(entry.deletedAt)) {
                    result.deleted.entries.push({ listId: bucket.listId, entryId: entry.id, deletedAt: entry.deletedAt });
                } else if (byId.has(bucket.listId)) {
                    byId.get(bucket.listId).entries.push({ ...entry });
                }
            }
        }
        result.lists.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
        result.lists.forEach(list => {
            list.entries.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
            list.updatedAt = list.entries.reduce((latest, entry) => Math.max(latest, timestamp(entry.updatedAt)), list.updatedAt);
        });
        result.selected = result.lists.some(list => list.id === selected) ? selected : result.lists[0]?.id || '';
        return result;
    }

    function fromDocuments(listDocs, bucketDocs) {
        return { lists: new Map(listDocs.map(doc => [doc.id, doc.data()])),
            buckets: new Map(bucketDocs.map(doc => [doc.id, doc.data()])) };
    }

    return { VOCAB_LIST_ID, BUCKETS, MAX_DOCUMENT_BYTES, empty, ensureVocabularyList, vocabularyEntryId, hash, pack, unpack, mergeList, mergeBucket, mergePacked, fromDocuments, same, sameSnapshot };
});
