(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WorkspaceSyncCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    const BUCKETS = 128;
    const MAX_DOCUMENT_BYTES = 700000;
    const encode = value => new TextEncoder().encode(JSON.stringify(value)).length;
    const hash = value => {
        let result = 2166136261;
        for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619) >>> 0;
        return (result % BUCKETS).toString(36).padStart(2, '0');
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

    function pack(snapshot) {
        const lists = new Map();
        const buckets = new Map();
        for (const [listIndex, list] of (snapshot?.lists || []).entries()) {
            if (!list?.id || !Array.isArray(list.entries)) continue;
            lists.set(list.id, { id: list.id, name: list.name, nameUpdatedAt: timestamp(list.nameUpdatedAt || list.updatedAt),
                createdAt: timestamp(list.createdAt || list.updatedAt), position: list.position ?? listIndex, deletedAt: 0 });
            list.entries.forEach((entry, index) => {
                if (!entry?.id) return;
                const id = `${list.id}~${hash(entry.id)}`;
                if (!buckets.has(id)) buckets.set(id, { listId: list.id, records: Object.create(null) });
                buckets.get(id).records[entry.id] = { ...entry, order: entry.order ?? index };
            });
        }
        for (const item of snapshot?.deleted?.lists || []) {
            if (!item?.listId) continue;
            const prior = lists.get(item.listId);
            lists.set(item.listId, { ...(prior || { id: item.listId, name: '', nameUpdatedAt: 0, createdAt: 0, position: 0 }),
                deletedAt: Math.max(timestamp(prior?.deletedAt), timestamp(item.deletedAt)) });
        }
        for (const item of snapshot?.deleted?.entries || []) {
            if (!item?.listId || !item?.entryId) continue;
            const id = `${item.listId}~${hash(item.entryId)}`;
            if (!buckets.has(id)) buckets.set(id, { listId: item.listId, records: Object.create(null) });
            const prior = buckets.get(id).records[item.entryId];
            buckets.get(id).records[item.entryId] = { ...(prior || { id: item.entryId }),
                deletedAt: Math.max(timestamp(prior?.deletedAt), timestamp(item.deletedAt)) };
        }
        for (const [id, data] of buckets) {
            if (encode(data) > MAX_DOCUMENT_BYTES) throw new Error(`词表 ${data.listId} 的分片 ${id} 过大，无法安全上传`);
        }
        return { lists, buckets };
    }

    function mergeList(a, b) {
        if (!a) return b;
        if (!b) return a;
        const winner = newer(a, b, 'nameUpdatedAt');
        const firstCreated = timestamp(a.createdAt) || Infinity;
        const secondCreated = timestamp(b.createdAt) || Infinity;
        return { ...winner, deletedAt: Math.max(timestamp(a.deletedAt), timestamp(b.deletedAt)),
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
            const winner = newer(prior, incoming, 'updatedAt');
            records[id] = { ...winner, deletedAt: Math.max(timestamp(prior.deletedAt), timestamp(incoming.deletedAt)) };
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
            if (timestamp(list.deletedAt)) {
                result.deleted.lists.push({ listId: list.id, deletedAt: list.deletedAt });
                continue;
            }
            const value = { id: list.id, name: list.name || '未命名词表', createdAt: list.createdAt || 0,
                nameUpdatedAt: list.nameUpdatedAt || 0, updatedAt: list.nameUpdatedAt || 0,
                position: list.position ?? 0, entries: [] };
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

    return { BUCKETS, MAX_DOCUMENT_BYTES, empty, hash, pack, unpack, mergeList, mergeBucket, mergePacked, fromDocuments, same, sameSnapshot };
});
