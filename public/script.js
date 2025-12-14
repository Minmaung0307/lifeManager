// --- 1. CONFIGURATION ---
// Google Cloud Console မှ ရယူပါ
const CLIENT_ID = '299263158228-o9m3ca5nmqrhg6sav527437ukiijrfu8.apps.googleusercontent.com'; // <--- ဒီမှာထည့်ပါ
const API_KEY = 'AIzaSyAfrHWN0UzusdTi964OrS71M6RQd5wF6UM';    

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let tokenClient;
let gapiInited = false;
let gisInited = false;

const DATA_FILE_NAME = "cloud_keeper_data_v3.json";
let driveFileId = null;
let vaultItems = [];
let currentFilter = 'all';
let currentView = 'grid';

// --- 2. INITIALIZATION & PERSISTENCE ---
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
    gapiInited = true;
    checkAuth();
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES, callback: '',
    });
    gisInited = true;
    checkAuth();
}

function checkAuth() {
    // 1. Check if both libraries loaded
    if (!gapiInited || !gisInited) return;

    // 2. Check LocalStorage for existing token
    const storedToken = localStorage.getItem('g_token');
    const storedExpiry = localStorage.getItem('g_token_exp');
    
    if (storedToken && storedExpiry && Date.now() < parseInt(storedExpiry)) {
        // Restore Token
        gapi.client.setToken({ access_token: storedToken });
        showApp();
    } else {
        // Show Login
        document.getElementById('login-view').style.display = 'flex';
    }
}

// --- 3. AUTHENTICATION ---
function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        
        // Save Token (Valid for 1 hour)
        const expiresIn = 3500 * 1000; // ~58 mins
        localStorage.setItem('g_token', resp.access_token);
        localStorage.setItem('g_token_exp', Date.now() + expiresIn);

        showApp();
    };
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

async function showApp() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'flex';
    await initDriveData();
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        localStorage.removeItem('g_token');
        localStorage.removeItem('g_token_exp');
        location.reload();
    }
}

// --- 4. DRIVE SYNC ENGINE (FIXED SPINNER) ---
async function initDriveData() {
    showSyncStatus(true);
    try {
        // User Profile
        try {
            const about = await gapi.client.drive.about.get({ fields: 'user' });
            const user = about.result.user;
            if(user) {
                document.getElementById('user-avatar').src = user.photoLink;
                document.getElementById('user-name').innerText = user.displayName;
            }
        } catch(e) {}

        // File Search
        const response = await gapi.client.drive.files.list({
            'q': `name = '${DATA_FILE_NAME}' and trashed = false`,
            'fields': 'files(id, name)',
        });
        
        const files = response.result.files;
        if (files && files.length > 0) {
            driveFileId = files[0].id;
            await loadFileContent();
        } else {
            await createDriveFile();
        }
    } catch (err) {
        console.error("Drive Error", err);
        if(err.status === 401) handleSignoutClick(); // Logout if token expired
        else alert("Sync Error: " + err.message);
    } finally {
        showSyncStatus(false); // ★ MUST RUN ★
    }
}

async function createDriveFile() {
    const fileContent = { items: [] };
    const file = new Blob([JSON.stringify(fileContent)], {type: 'application/json'});
    const metadata = { 'name': DATA_FILE_NAME, 'mimeType': 'application/json' };
    const accessToken = gapi.client.getToken().access_token;
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
        body: form,
    });
    const val = await res.json();
    driveFileId = val.id;
    vaultItems = [];
    renderList();
}

async function loadFileContent() {
    const res = await gapi.client.drive.files.get({ fileId: driveFileId, alt: 'media' });
    vaultItems = res.result.items || [];
    renderList();
}

async function saveToDrive() {
    showSyncStatus(true);
    try {
        const content = { items: vaultItems };
        const accessToken = gapi.client.getToken().access_token;
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
            method: 'PATCH',
            headers: new Headers({ 
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify(content),
        });
        console.log("Saved.");
    } catch(e) {
        alert("Save Failed: " + e.message);
    } finally {
        showSyncStatus(false);
    }
}

function showSyncStatus(show) {
    const el = document.getElementById('sync-status');
    if(show) el.classList.remove('hidden'); else el.classList.add('hidden');
}

// --- 5. UI LOGIC (View, Fav, Icons) ---

function toggleView(view) {
    currentView = view;
    document.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-' + view).classList.add('active');
    
    const listDiv = document.getElementById('data-list');
    if(view === 'list') {
        listDiv.classList.remove('grid-layout');
        listDiv.classList.add('list-layout');
    } else {
        listDiv.classList.remove('list-layout');
        listDiv.classList.add('grid-layout');
    }
}

function toggleFav(id) {
    const idx = vaultItems.findIndex(i => i.id === id);
    if(idx !== -1) {
        vaultItems[idx].isFav = !vaultItems[idx].isFav;
        renderList();
        saveToDrive();
    }
}

function renderList() {
    const listDiv = document.getElementById('data-list');
    const search = document.getElementById('search-input').value.toLowerCase();
    listDiv.innerHTML = '';

    let items = vaultItems.filter(i => {
        const matchesSearch = i.title.toLowerCase().includes(search);
        if (currentFilter === 'all') return matchesSearch;
        if (currentFilter === 'fav') return i.isFav && matchesSearch;
        return i.category === currentFilter && matchesSearch;
    });

    const icons = {
        social: 'fa-globe', bank: 'fa-wallet', home: 'fa-home', work: 'fa-briefcase',
        wireless: 'fa-wifi', tv: 'fa-tv', auto: 'fa-car', insurance: 'fa-file-contract',
        other: 'fa-key'
    };

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'card';
        div.innerHTML = `
            <div class="card-header">
                <div class="cat-icon"><i class="fas ${icons[item.category] || 'fa-key'}"></i></div>
                <div class="card-title-wrap">
                    <div class="card-title">${item.title}</div>
                    <div class="card-user">${item.user || 'No User'}</div>
                </div>
                <div class="card-actions">
                    <button class="btn-star ${item.isFav ? 'active' : ''}" onclick="toggleFav('${item.id}')">
                        <i class="${item.isFav ? 'fas' : 'far'} fa-star"></i>
                    </button>
                    <button onclick="editItem('${item.id}')"><i class="fas fa-pen"></i></button>
                    <button onclick="deleteItem('${item.id}')" style="color:#EF4444;"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            
            <div class="card-pass" onclick="toggleBlur(this)">
                <span class="blur">${item.pass}</span>
                <i class="fas fa-eye"></i>
            </div>
        `;
        listDiv.appendChild(div);
    });
}

function filterData(cat) {
    currentFilter = cat;
    document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
    renderList();
}

function saveEntry() {
    const title = document.getElementById('inp-title').value;
    const user = document.getElementById('inp-user').value;
    const pass = document.getElementById('inp-pass').value;
    const cat = document.getElementById('inp-cat').value;
    const note = document.getElementById('inp-note').value;
    const id = document.getElementById('entry-id').value || Date.now().toString();

    if(!title || !pass) return alert("Title and Password required");

    let isFav = false;
    const existing = vaultItems.find(i => i.id === id);
    if(existing) isFav = existing.isFav;

    const newItem = { id, title, user, pass, category: cat, note, isFav };

    if (document.getElementById('entry-id').value) {
        const idx = vaultItems.findIndex(i => i.id === id);
        vaultItems[idx] = newItem;
    } else {
        vaultItems.unshift(newItem);
    }

    closeModal();
    renderList();
    saveToDrive();
}

function deleteItem(id) {
    if(confirm("Delete?")) {
        vaultItems = vaultItems.filter(i => i.id !== id);
        renderList();
        saveToDrive();
    }
}

function editItem(id) {
    const item = vaultItems.find(i => i.id === id);
    document.getElementById('entry-id').value = item.id;
    document.getElementById('inp-title').value = item.title;
    document.getElementById('inp-user').value = item.user;
    document.getElementById('inp-pass').value = item.pass;
    document.getElementById('inp-cat').value = item.category;
    document.getElementById('inp-note').value = item.note;
    openModal('edit');
}

function openModal(mode) {
    document.getElementById('entry-modal').style.display = 'flex';
    const title = document.getElementById('modal-title');
    if(mode === 'edit') {
        title.innerHTML = '<i class="fas fa-edit"></i> Edit Account';
    } else {
        title.innerHTML = '<i class="fas fa-pen-to-square"></i> New Account';
        document.getElementById('entry-id').value = '';
        document.getElementById('inp-title').value = '';
        document.getElementById('inp-user').value = '';
        document.getElementById('inp-pass').value = '';
        document.getElementById('inp-note').value = '';
    }
}
function closeModal() { document.getElementById('entry-modal').style.display = 'none'; }
function openGuide() { document.getElementById('guide-modal').style.display = 'flex'; }
function closeGuide() { document.getElementById('guide-modal').style.display = 'none'; }

function toggleBlur(el) { 
    const span = el.querySelector('span');
    span.classList.toggle('blur'); 
    span.classList.toggle('no-blur');
}
function genPass() {
    document.getElementById('inp-pass').value = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
}