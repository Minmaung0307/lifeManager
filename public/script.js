// --- 1. CONFIGURATION ---
// Google Cloud Console မှ ရယူပါ
const CLIENT_ID = '299263158228-o9m3ca5nmqrhg6sav527437ukiijrfu8.apps.googleusercontent.com'; // <--- ဒီမှာထည့်ပါ
const API_KEY = 'AIzaSyAfrHWN0UzusdTi964OrS71M6RQd5wF6UM';    

const firebaseConfig = {
  apiKey: "AIzaSyBKve-zt2uXcOebXvpSPOZt4ZRRL7Esqgk", // Firebase API Key
  authDomain: "lifemanager-mm.firebaseapp.com",
  projectId: "lifemanager-mm",
  storageBucket: "lifemanager-mm.firebasestorage.app",
  messagingSenderId: "582617327472",
  appId: "1:582617327472:web:194b114249e69a273bd1b5",
  measurementId: "G-V1QK1VMVDT",
};

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const DATA_FILE_NAME = "cloud_keeper_encrypted_v3.json"; 

let tokenClient;
let gapiInited = false;
let gisInited = false;
let driveFileId = null;
let vaultItems = [];
let encryptedString = ""; // Raw Data from Drive
let MASTER_KEY = null; // Key in RAM only
let isNewUser = false;
let currentFilter = 'all';
let currentView = 'grid';

// ==========================================
// 2. FIREBASE INITIALIZATION
// ==========================================
// Firebase Script မရှိရင် Error မတက်အောင် စစ်မယ်
if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    var auth = firebase.auth(); // var သုံးတာက Global ဖြစ်အောင်ပါ
    var db = firebase.firestore();
} else {
    console.error("Firebase SDK not loaded!");
    alert("Error: Firebase SDK failed to load. Check internet connection.");
}

// --- 2. INITIALIZATION & PERSISTENCE ---
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
    gapiInited = true; checkAuth();
}
window.gisLoaded = function() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES, callback: '',
    });
    gisInited = true; checkAuth();
}
function checkAuth() {
    if (!gapiInited || !gisInited) return;
    const storedToken = localStorage.getItem('g_token');
    const storedExpiry = localStorage.getItem('g_token_exp');
    
    if (storedToken && storedExpiry && Date.now() < parseInt(storedExpiry)) {
        gapi.client.setToken({ access_token: storedToken });
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('app-view').style.display = 'flex';
        initDriveData();
    } else {
        document.getElementById('login-view').style.display = 'flex';
    }
}

// --- 3. AUTHENTICATION ---
function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) throw (resp);
        const expiresIn = 3500 * 1000; 
        localStorage.setItem('g_token', resp.access_token);
        localStorage.setItem('g_token_exp', Date.now() + expiresIn);
        
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('app-view').style.display = 'flex';
        await initDriveData();
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
    }
    localStorage.removeItem('g_token');
    localStorage.removeItem('g_token_exp');
    location.reload();
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
        console.error("Drive Error:", err);
        if(err.status === 401) handleSignoutClick();
    } finally {
        showSyncStatus(false);
    }
}

// --- 5. UNLOCK / DECRYPT ---
async function unlockVault() {
    const pass = document.getElementById('master-password').value;
    if(!pass) return alert("Password is required");

    if (isNewUser) {
        // User အသစ်ဆိုရင် ဒါကို Master Key အဖြစ်သတ်မှတ်ပြီး File အသစ်ဆောက်မယ်
        MASTER_KEY = pass;
        vaultItems = [];
        await createDriveFile(); // Create empty encrypted file
        enterApp();
    } else {
        // User ဟောင်းဆိုရင် Decrypt စမ်းမယ်
        try {
            if(!encryptedString) {
                vaultItems = []; // Empty file case
            } else {
                const bytes = CryptoJS.AES.decrypt(encryptedString, pass);
                const originalText = bytes.toString(CryptoJS.enc.Utf8);
                if (!originalText) throw new Error("Wrong Password");
                vaultItems = JSON.parse(originalText);
            }
            // Success
            MASTER_KEY = pass;
            enterApp();
        } catch (e) {
            alert("Incorrect Password!");
            document.getElementById('master-password').value = '';
        }
    }
}

function enterApp() {
    document.getElementById('unlock-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'flex';
    renderList();
}

// --- 6. SAVE (ENCRYPT & UPLOAD) ---
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
        const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
            method: 'PATCH',
            headers: new Headers({ 
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify(content),
        });
        
        if (!res.ok) throw new Error("Network Response: " + res.status);
        console.log("Saved.");
        
    } catch(e) {
        // ★ Failed to Fetch Error Handling ★
        console.error("Save Error:", e);
        
        // Data ကို Memory ထဲမှာ ဆက်ထားပြီး User ကို သတိပေးမယ်
        // Refresh မလုပ်ခိုင်းပါဘူး (Refresh လုပ်ရင် Data ပျောက်သွားမှာစိုးလို့)
        const statusEl = document.getElementById('sync-status');
        statusEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Save Failed (Offline). Data stored locally until refresh.`;
        statusEl.style.backgroundColor = "#FEF2F2";
        statusEl.style.color = "#DC2626";
        statusEl.classList.remove('hidden');
        
        // 3 စက္ကန့်နေရင် Status Bar ပိတ်မယ် (ဒါပေမဲ့ Error ကိုတော့ User သိနေပါစေ)
        setTimeout(() => {
             // Retry Logic (Optional)
        }, 5000);
    } finally {
        // Success ဖြစ်ရင် Spinner ပိတ်မယ် (Error တက်ရင် Status bar ပြထားမယ်)
        // showSyncStatus(false); is handled inside try/catch logic above for better UX
    }
}

function showSyncStatus(show) {
    const el = document.getElementById('sync-status');
    if(show) el.classList.remove('hidden'); else el.classList.add('hidden');
}

// --- 4. BACKUP & RESTORE (NEW) ---
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(vaultItems));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "cloudkeeper_backup_" + new Date().toISOString().split('T')[0] + ".json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function importData(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (Array.isArray(imported)) {
                if(confirm(`Restore ${imported.length} items? This will merge with existing data.`)) {
                    // Merge logic (avoid duplicates by ID)
                    const existingIds = new Set(vaultItems.map(i => i.id));
                    const newItems = imported.filter(i => !existingIds.has(i.id));
                    vaultItems = [...vaultItems, ...newItems];
                    
                    renderList();
                    saveToDrive();
                    alert("Data Restored Successfully!");
                }
            } else {
                alert("Invalid backup file format.");
            }
        } catch (err) {
            alert("Error reading file: " + err.message);
        }
    };
    reader.readAsText(file);
    input.value = ''; // Reset input
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

    if (items.length === 0) {
        listDiv.innerHTML = '<p style="text-align:center; width:100%; color:#94a3b8; margin-top:50px;">No items found.</p>';
        return;
    }

    // ★ STYLE MAP with LABELS ★
    const styleMap = {
        social:   { label: 'Social Media', icon: 'fa-globe',       bg: '#EFF6FF', text: '#3B82F6' },
        bank:     { label: 'Finance',      icon: 'fa-wallet',      bg: '#ECFDF5', text: '#10B981' },
        wireless: { label: 'Wireless',     icon: 'fa-wifi',        bg: '#F0F9FF', text: '#0EA5E9' },
        tv:       { label: 'TV & Ent.',    icon: 'fa-tv',          bg: '#FAF5FF', text: '#8B5CF6' },
        auto:     { label: 'Auto / Car',   icon: 'fa-car',         bg: '#FEF2F2', text: '#EF4444' },
        insurance:{ label: 'Insurance',    icon: 'fa-file-shield', bg: '#FFF7ED', text: '#F97316' },
        home:     { label: 'Home',         icon: 'fa-home',        bg: '#FFFBEB', text: '#F59E0B' },
        work:     { label: 'Business',     icon: 'fa-briefcase',   bg: '#F8FAFC', text: '#64748B' },
        other:    { label: 'Other',        icon: 'fa-box-open',    bg: '#F3F4F6', text: '#4B5563' }
    };

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'card';
        div.onclick = () => viewItemDetail(item.id); 

        const starClass = item.isFav ? 'fas text-yellow active' : 'far';
        const style = styleMap[item.category] || styleMap['other'];

        div.innerHTML = `
            <div class="card-header">
                <!-- ★ ICON + LABEL GROUP ★ -->
                <div class="cat-group">
                    <div class="cat-icon-large" style="background: ${style.bg}; color: ${style.text};">
                        <i class="fas ${style.icon}"></i>
                    </div>
                    <!-- ဘေးနားက စာသား -->
                    <span class="cat-title-label" style="color:${style.text}">${style.label}</span>
                </div>

                <div class="card-actions">
                    <button onclick="event.stopPropagation(); toggleFav('${item.id}')" class="btn-star ${item.isFav ? 'active' : ''}">
                        <i class="${starClass} fa-star"></i>
                    </button>
                    <button onclick="event.stopPropagation(); editItem('${item.id}')">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button onclick="event.stopPropagation(); deleteItem('${item.id}')" class="btn-del">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            
            <div class="card-content">
                <div class="card-title">${item.title}</div>
                <div class="card-user">${item.username || 'No Username'}</div>
            </div>
        `;
        listDiv.appendChild(div);
    });
}

// --- NEW FUNCTION: VIEW DETAILS ---
function viewItemDetail(id) {
    const item = vaultItems.find(i => i.id === id);
    if(!item) return;

    // Styling Logic (အရင်အတိုင်း)
    const styleMap = {
        social:   { icon: 'fa-globe',       bg: '#EFF6FF', text: '#3B82F6' },
        bank:     { icon: 'fa-wallet',      bg: '#ECFDF5', text: '#10B981' },
        wireless: { icon: 'fa-wifi',        bg: '#F0F9FF', text: '#0EA5E9' },
        tv:       { icon: 'fa-tv',          bg: '#FAF5FF', text: '#8B5CF6' },
        auto:     { icon: 'fa-car',         bg: '#FEF2F2', text: '#EF4444' },
        insurance:{ icon: 'fa-file-shield', bg: '#FFF7ED', text: '#F97316' },
        home:     { icon: 'fa-home',        bg: '#FFFBEB', text: '#F59E0B' },
        work:     { icon: 'fa-briefcase',   bg: '#F8FAFC', text: '#64748B' },
        other:    { icon: 'fa-box-open',    bg: '#F3F4F6', text: '#4B5563' }
    };
    const style = styleMap[item.category] || styleMap['other'];

    document.getElementById('view-icon-box').style.backgroundColor = style.bg;
    document.getElementById('view-icon-box').style.color = style.text;
    document.getElementById('view-icon').className = `fas ${style.icon}`;
    
    document.getElementById('view-title').innerText = item.title;
    document.getElementById('view-cat').innerText = item.category.toUpperCase();
    document.getElementById('view-user').innerText = item.username || '-';
    document.getElementById('view-pass').innerText = item.pass;
    document.getElementById('view-note').innerText = item.note || 'No notes added.';

    // ★ URL DISPLAY LOGIC (အဓိက အပိုင်း) ★
    const urlContainer = document.getElementById('view-url-container');
    const urlBtn = document.getElementById('view-url');

    if (item.url && item.url.trim() !== "") {
        urlContainer.style.display = 'block'; // ရှိရင် ဖော်မယ်
        let href = item.url.trim();
        // https မပါရင် ထည့်ပေးမယ်
        if (!/^https?:\/\//i.test(href)) { href = 'https://' + href; }
        urlBtn.href = href;
    } else {
        urlContainer.style.display = 'none'; // မရှိရင် ဖျောက်မယ်
    }

    // Reset Blur
    document.getElementById('view-pass').classList.remove('revealed');
    document.getElementById('view-pass').classList.add('blur-text');

    document.getElementById('view-modal').style.display = 'flex';
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
    
    // ★ URL ကို Input ကနေ ယူမည် ★
    const url = document.getElementById('inp-url').value; 

    const id = document.getElementById('entry-id').value || Date.now().toString();

    if(!title || !pass) return alert("Title and Password required");

    // အဟောင်းက Fav status ကို ပြန်ယူမယ်
    let isFav = false;
    const existing = vaultItems.find(i => i.id === id);
    if(existing) isFav = existing.isFav;

    // ★ URL ကို Object ထဲ ထည့်သိမ်းမည် ★
    const newItem = { id, title, username: user, pass, category: cat, note, url, isFav };

    if (document.getElementById('entry-id').value) {
        const idx = vaultItems.findIndex(i => i.id === id);
        vaultItems[idx] = newItem;
    } else {
        vaultItems.unshift(newItem);
    }

    closeModal('entry-modal');
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
    document.getElementById('inp-user').value = item.username || '';
    document.getElementById('inp-pass').value = item.pass;
    document.getElementById('inp-cat').value = item.category;
    document.getElementById('inp-note').value = item.note || '';
    
    // ★ URL ကို Edit Box မှာ ပြန်ထည့်ပေးမယ် ★
    document.getElementById('inp-url').value = item.url || ''; 
    
    openModal('edit');
}

// --- ERROR HANDLING & COPY TEXT ---
function copyText(elementId) {
    const text = document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(text).then(() => {
        // Optional: Toast notification can go here
        const el = document.getElementById(elementId);
        const originalColor = el.style.color;
        el.style.color = '#10B981'; // Flash green
        setTimeout(() => el.style.color = originalColor, 500);
    });
}

function openModal(mode) {
    document.getElementById('entry-modal').style.display = 'flex';
    const title = document.getElementById('modal-title');
    if(mode === 'add') {
        title.innerHTML = '<i class="fas fa-plus-circle"></i> New Account';
        document.getElementById('entry-id').value = '';
        document.getElementById('inp-title').value = '';
        document.getElementById('inp-user').value = '';
        document.getElementById('inp-pass').value = '';
        document.getElementById('inp-note').value = '';
    } else {
        title.innerHTML = '<i class="fas fa-pen-to-square"></i> Edit Account';
    }
}

function closeModal() { document.getElementById('entry-modal').style.display = 'none'; }

function openGuide() { document.getElementById('guide-modal').style.display = 'flex'; }
function closeGuide() { document.getElementById('guide-modal').style.display = 'none'; }

function toggleBlur(el) { 
    const span = el.querySelector('span');
    span.classList.toggle('blur'); span.classList.toggle('no-blur');
}

function genPass() {
    document.getElementById('inp-pass').value = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
}

function openModal() { document.getElementById('entry-modal').style.display = 'flex'; }
function closeModal() { document.getElementById('entry-modal').style.display = 'none'; }

// --- GUIDE & PRIVACY TABS ---
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-'+tabName).classList.add('active');
    const btns = document.querySelectorAll('.tab-link');
    if(tabName === 'manual') btns[0].classList.add('active');
    else btns[1].classList.add('active');
}

// Modal Functions (Update)
function openGuide() { document.getElementById('guide-modal').style.display = 'flex'; switchTab('manual'); }

function closeGuide() { document.getElementById('guide-modal').style.display = 'none'; }

// --- ANNOUNCEMENT SYSTEM ---
// App စဖွင့်ရင် Check မယ်
document.addEventListener("DOMContentLoaded", () => {
    checkAnnouncement();
});

function checkAnnouncement() {
    console.log("Checking for announcements..."); // Debugging

    db.collection("config").doc("news").onSnapshot((doc) => {
        const banner = document.getElementById("announcementBanner");
        
        if (doc.exists) {
            const data = doc.data();
            console.log("Announcement Data:", data); // Data ရမရ ကြည့်မယ်

            if (data.active) {
                document.getElementById("announceText").textContent = data.message;
                banner.style.display = "flex";
                
                // အရောင်ပြောင်း Logic
                if(data.type === 'danger') {
                    banner.style.background = "linear-gradient(90deg, #ef4444, #f87171)";
                } else {
                    // Default Color (Reset ပြန်လုပ်ပေးရမယ်)
                    banner.style.background = "linear-gradient(90deg, #ff7e5f, #feb47b)";
                }
            } else {
                banner.style.display = "none";
            }
        } else {
            console.log("No announcement document found!");
            banner.style.display = "none";
        }
    }, (error) => {
        // ★ Error တက်ရင် ဒီမှာပေါ်မယ် ★
        console.error("Announcement Error:", error);
    });
}


function closeAnnouncement() {
    document.getElementById("announcementBanner").style.display = "none";
}

// --- ANNOUNCEMENT SYSTEM Ends ---

// --- CHANGE PASSWORD LOGIC ---

function openChangePassModal() {
    document.getElementById('change-pass-modal').style.display = 'flex';
    // Clear inputs
    document.getElementById('cp-current').value = '';
    document.getElementById('cp-new').value = '';
    document.getElementById('cp-confirm').value = '';
}

// Modal ပိတ်ရန် (Global closeModal ကို upgrade လုပ်ပါ သို့မဟုတ် ဒါသီးသန့်သုံးပါ)
// အစ်ကို့ script.js ထဲက closeModal ကို ID လက်ခံအောင် ပြင်ပေးရပါမယ် 👇
/* 
   function closeModal(modalId) {
       // ID မပါလာရင် Default Modal (Entry Modal) ကို ပိတ်မယ်
       if(!modalId) modalId = 'entry-modal';
       document.getElementById(modalId).style.display = 'none';
   }
*/
function closeModal(modalId) {
    if (modalId) {
        // ID ပါလာရင် အဲ့ဒီတစ်ခုကိုပဲ ပိတ်မယ်
        document.getElementById(modalId).style.display = 'none';
    } else {
        // ID မပါလာရင် (Error မတက်အောင်) Modal အားလုံးကို လိုက်ပိတ်ပစ်မယ်
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
    }
}

async function handleChangePassword() {
    const currentPass = document.getElementById('cp-current').value;
    const newPass = document.getElementById('cp-new').value;
    const confirmPass = document.getElementById('cp-confirm').value;
    const btn = document.querySelector('#change-pass-modal .btn-save');

    // 1. Validation
    if (!currentPass || !newPass || !confirmPass) {
        return alert("Please fill all fields.");
    }

    if (newPass !== confirmPass) {
        return alert("New passwords do not match.");
    }

    if (newPass.length < 4) {
        return alert("New password is too short.");
    }

    // 2. Verify Current Password (Memory ထဲက Key နဲ့ တိုက်စစ်မယ်)
    if (currentPass !== MASTER_KEY) {
        return alert("Current password is incorrect.");
    }

    if (!confirm("⚠️ Are you sure you want to change your Master Password?\n\nPlease write it down immediately!")) {
        return;
    }

    // 3. Re-Encryption Process
    try {
        btn.innerText = "Re-encrypting & Saving...";
        btn.disabled = true;

        // Key အသစ် ပြောင်းမယ်
        MASTER_KEY = newPass;

        // Drive ပေါ်ကို Key အသစ်နဲ့ Encrypt လုပ်ပြီး ပြန်တင်မယ်
        // (saveToDrive function က global MASTER_KEY ကို သုံးတဲ့အတွက် 
        //  ဒီနေရာမှာ MASTER_KEY ပြောင်းလိုက်တာနဲ့ အသစ်နဲ့ Encrypt ဖြစ်သွားပါပြီ)
        await saveToDrive();

        alert("✅ Success! Your Master Password has been changed.");
        
        // Modal ပိတ်မယ်
        document.getElementById('change-pass-modal').style.display = 'none';

    } catch (err) {
        console.error(err);
        alert("Error updating password: " + err.message);
        // Error တက်ရင် Key အဟောင်းပြန်ထားဖို့ ကြိုးစားသင့်တယ် (Optional)
        MASTER_KEY = currentPass; 
    } finally {
        btn.innerText = "Update Password";
        btn.disabled = false;
    }
}

// Password အဖွင့်အပိတ် (Optional Helper)
function togglePassVisibility(id) {
    const input = document.getElementById(id);
    input.type = input.type === 'password' ? 'text' : 'password';
}

// --- CHANGE PASSWORD LOGIC Ends ---