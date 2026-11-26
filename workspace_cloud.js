import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, doc, getDocsFromServer, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: 'AIzaSyCwnIOgEkgavgJ8QYuZB2gzoRwtqEzK2TU',
    authDomain: 'lexicon-studio.firebaseapp.com',
    projectId: 'lexicon-studio',
    storageBucket: 'lexicon-studio.firebasestorage.app',
    messagingSenderId: '540845354358',
    appId: '1:540845354358:web:472e4f0479a70f4c5f1e57'
};

const core = window.WorkspaceSyncCore;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch { db = getFirestore(app); }
const status = document.getElementById('cloudStatus');
const CLAIMED_KEY = 'dictionary_workspace_guest_claimed_v1';
let activeUid = '';
let ready = false;
let generation = 0;
let stops = [];
let remote = { lists: new Map(), buckets: new Map() };
let queued = Promise.resolve();
let timer = 0;
let uploading = false;
let connectionToken = -1;

function setStatus(message, state = '') {
    status.textContent = message;
    status.dataset.state = state;
    status.title = message;
}
const paths = uid => ({
    lists: collection(db, 'users', uid, 'wordlists'),
    buckets: collection(db, 'users', uid, 'wordlistChunks')
});
const clean = value => JSON.parse(JSON.stringify(value));
const current = token => token === generation && auth.currentUser?.uid === activeUid;

async function workspace() {
    if (window.WordlistWorkspace) return window.WordlistWorkspace;
    return new Promise(resolve => window.addEventListener('wordlist:ready', () => resolve(window.WordlistWorkspace), { once: true }));
}

async function fetchRemote(uid) {
    const path = paths(uid);
    const [lists, buckets] = await Promise.all([getDocsFromServer(path.lists), getDocsFromServer(path.buckets)]);
    return core.fromDocuments(lists.docs, buckets.docs);
}

async function uploadDifferences(uid, target, token) {
    const path = paths(uid);
    const jobs = [];
    for (const [id, value] of target.lists) {
        if (!core.same(remote.lists.get(id), value)) jobs.push({ ref: path.lists, id, value, merge: core.mergeList, kind: 'lists' });
    }
    for (const [id, value] of target.buckets) {
        if (!core.same(remote.buckets.get(id), value)) jobs.push({ ref: path.buckets, id, value, merge: core.mergeBucket, kind: 'buckets' });
    }
    const groups = [];
    for (let start = 0; start < jobs.length; start += 20) groups.push(jobs.slice(start, start + 20));
    let index = 0;
    let completed = 0;
    const workers = Array.from({ length: Math.min(4, groups.length) }, async () => {
        while (index < groups.length && current(token)) {
            const group = groups[index++];
            const merged = await runTransaction(db, async transaction => {
                const references = group.map(job => doc(job.ref, job.id));
                // Firestore transactions require every read to finish before the first write.
                const previous = await Promise.all(references.map(reference => transaction.get(reference)));
                const values = group.map((job, offset) => {
                    const old = previous[offset];
                    const value = clean(job.merge(old.exists() ? old.data() : null, job.value));
                    if (job.kind === 'buckets' && new TextEncoder().encode(JSON.stringify(value)).length > core.MAX_DOCUMENT_BYTES)
                        throw new Error('合并后的词表分片超过安全大小，请缩短过长的备注');
                    if (!old.exists() || !core.same(old.data(), value)) transaction.set(references[offset], value);
                    return value;
                });
                return values;
            });
            if (!current(token)) return;
            group.forEach((job, offset) => remote[job.kind].set(job.id, merged[offset]));
            completed += group.length;
            if (jobs.length > 20) setStatus(`词表同步中 · ${completed}/${jobs.length}`);
        }
    });
    await Promise.all(workers);
    return jobs.length;
}

async function reconcile(token) {
    if (!ready || !current(token) || uploading) return;
    uploading = true;
    try {
        setStatus('词表同步中…');
        const api = await workspace();
        const before = api.getSnapshot();
        const local = core.pack(before);
        const merged = core.mergePacked(local, remote);
        const snapshot = core.unpack(merged, before.selected);
        if (!core.sameSnapshot(before, snapshot)) await api.applySnapshot(snapshot);
        if (!current(token)) return;
        await uploadDifferences(activeUid, merged, token);
        if (!current(token)) return;
        const after = api.getSnapshot();
        const finalSnapshot = core.unpack(core.mergePacked(core.pack(after), remote), after.selected);
        if (!core.sameSnapshot(after, finalSnapshot)) await api.applySnapshot(finalSnapshot);
        setStatus(`词表已同步 · ${finalSnapshot.lists.length} 份`, 'synced');
    } catch (error) {
        setStatus(`词表同步未完成：${error.message}`, 'error');
        ready = false;
    } finally { uploading = false; }
}

function schedule(token, delay = 350) {
    clearTimeout(timer);
    if (!ready || !current(token)) return;
    timer = setTimeout(() => { queued = queued.catch(() => {}).then(() => reconcile(token)); }, delay);
}

function watch(uid, token) {
    const path = paths(uid);
    const observe = (ref, kind) => onSnapshot(ref, snapshot => {
        if (!current(token) || snapshot.metadata?.fromCache) return;
        remote[kind] = new Map(snapshot.docs.map(item => [item.id, item.data()]));
        schedule(token, 80);
    }, error => setStatus(`云端订阅失败：${error.message}`, 'error'));
    stops = [observe(path.lists, 'lists'), observe(path.buckets, 'buckets')];
}

async function connect(user, token) {
    const api = await workspace();
    if (!current(token)) return;
    setStatus('正在读取云端词表…');
    const claimed = localStorage.getItem(CLAIMED_KEY);
    const mayClaimGuest = !claimed || claimed === user.uid;
    const guest = mayClaimGuest ? await api.readArchive('workspace') : core.empty();
    if (!current(token)) return;
    await api.activateArchive(`user:${user.uid}`, mayClaimGuest ? guest : undefined);
    if (!current(token)) return;
    if (mayClaimGuest && Array.isArray(guest.lists) && guest.lists.length) {
        const merged = core.unpack(core.mergePacked(core.pack(api.getSnapshot()), core.pack(guest)), api.getSnapshot().selected);
        await api.applySnapshot(merged);
    }
    remote = await fetchRemote(user.uid);
    if (!current(token)) return;
    ready = true;
    await reconcile(token);
    if (!ready || !current(token)) return;
    watch(user.uid, token);
    if (mayClaimGuest) {
        localStorage.setItem(CLAIMED_KEY, user.uid);
        await api.writeArchive('workspace', core.empty());
    }
}

async function connectOnce(user, token) {
    if (!user || connectionToken === token) return;
    connectionToken = token;
    try { await connect(user, token); }
    finally { if (connectionToken === token) connectionToken = -1; }
}

onAuthStateChanged(auth, async user => {
    const token = ++generation;
    clearTimeout(timer);
    stops.forEach(stop => stop());
    stops = [];
    ready = false;
    activeUid = user?.uid || '';
    const api = await workspace();
    if (token !== generation) return;
    if (!user) {
        await api.activateArchive('workspace');
        setStatus('未登录 · 词表仅保存在本机');
        return;
    }
    try { await connectOnce(user, token); }
    catch (error) { if (current(token)) setStatus(`词表云同步未就绪：${error.message}`, 'error'); }
});

window.addEventListener('wordlist:changed', () => schedule(generation));
window.addEventListener('online', () => {
    if (!activeUid) return;
    if (!ready) void connectOnce(auth.currentUser, generation).catch(error => setStatus(`重连失败：${error.message}`, 'error'));
    else schedule(generation, 100);
});
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !activeUid) return;
    if (ready) schedule(generation, 100);
    else void connectOnce(auth.currentUser, generation).catch(error => setStatus(`重连失败：${error.message}`, 'error'));
});
