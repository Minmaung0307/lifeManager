// --- 1. CONFIGURATION ---
// Google Cloud Console မှ ရယူပါ
const CLIENT_ID = '299263158228-o9m3ca5nmqrhg6sav527437ukiijrfu8.apps.googleusercontent.com'; // <--- ဒီမှာထည့်ပါ
const API_KEY = 'AIzaSyAfrHWN0UzusdTi964OrS71M6RQd5wF6UM';    

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let tokenClient;
let gapiInited = false;
let gisInited = false;

const DATA_FILE_NAME = "cloud_keeper_encrypted_v1.json"; 

let driveFileId = null;
let vaultItems = [];
let encryptedString = ""; // Raw Data from Drive
let MASTER_KEY = null; // Key in RAM only
let isNewUser = false;
let currentFilter = 'all';
let currentView = 'grid';

// --- 2. INITIALIZATION & PERSISTENCE ---
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
    gapiInited = true; checkAuth();
}
function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES, callback: '',
    });
    gisInited = true; checkAuth();
}
function checkAuth() {
    // Check LocalStorage for existing session
    const storedToken = localStorage.getItem('g_token');
    const storedExpiry = localStorage.getItem('g_token_exp');
    if (gapiInited && gisInited && storedToken && storedExpiry && Date.now() < parseInt(storedExpiry)) {
        gapi.client.setToken({ access_token: storedToken });
        initDriveData(); // Token ရှိရင် Drive စဆွဲမယ်
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
    // Google API မပွင့်သေးရင်တောင် Logout ဖြစ်အောင်လုပ်မယ်
    try {
        const token = gapi.client.getToken();
        if (token !== null) {
            google.accounts.oauth2.revoke(token.access_token);
            gapi.client.setToken('');
        }
    } catch (e) {
        console.log("GAPI Error (Ignoring):", e);
    }

    // Local Storage ရှင်းပြီး Reload လုပ်မယ်
    localStorage.removeItem('g_token');
    localStorage.removeItem('g_token_exp');
    location.reload();
}

// --- 4. DRIVE SYNC ENGINE (FIXED SPINNER) ---
async function initDriveData() {
    document.getElementById('login-view').style.display = 'none';
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
            // File Found -> Download Encrypted Data
            driveFileId = files[0].id;
            const res = await gapi.client.drive.files.get({ fileId: driveFileId, alt: 'media' });
            
            // Result က JSON Object (encrypt လုပ်ထားတဲ့ text ပါမယ်)
            const result = res.result; 
            encryptedString = result.data || ""; // "U2FsdGVkX1..."
            
            // Show Unlock Screen
            isNewUser = false;
            document.getElementById('unlock-title').innerText = "Unlock Vault";
            document.getElementById('unlock-msg').innerText = "Enter Master Password to Decrypt";
            document.getElementById('unlock-view').style.display = 'flex';

        } else {
            // New User -> Create File & Set Password
            isNewUser = true;
            document.getElementById('unlock-title').innerText = "Create Master Password";
            document.getElementById('unlock-msg').innerText = "Set a password to encrypt your data.";
            document.getElementById('unlock-view').style.display = 'flex';
        }
    } catch (err) {
        if(err.status === 401) handleSignoutClick();
        else alert("Drive Error: " + err.message);
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
    // Encrypt empty array
    const cipher = CryptoJS.AES.encrypt(JSON.stringify([]), MASTER_KEY).toString();
    const fileContent = { data: cipher };
    
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
}

async function loadFileContent() {
    const res = await gapi.client.drive.files.get({ fileId: driveFileId, alt: 'media' });
    vaultItems = res.result.items || [];
    renderList();
}

async function saveToDrive() {
    showSyncStatus(true);
    try {
        // Encrypt Data
        const cipher = CryptoJS.AES.encrypt(JSON.stringify(vaultItems), MASTER_KEY).toString();
        const content = { data: cipher };

        const accessToken = gapi.client.getToken().access_token;
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
            method: 'PATCH',
            headers: new Headers({ 
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify(content),
        });
        console.log("Encrypted & Saved.");
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
        // Status ပြောင်းမယ် (True <-> False)
        vaultItems[idx].isFav = !vaultItems[idx].isFav;
        
        // UI ပြန်ဆွဲမယ်
        renderList();
        
        // Drive ပေါ် Save မယ်
        saveToDrive(); 
    }
}

function renderList() {
    const listDiv = document.getElementById('data-list');
    const search = document.getElementById('search-input').value.toLowerCase();
    listDiv.innerHTML = '';

    // Filter Logic
    let items = vaultItems.filter(i => {
        const matchesSearch = i.title.toLowerCase().includes(search);
        
        if (currentFilter === 'all') return matchesSearch;
        if (currentFilter === 'fav') return i.isFav && matchesSearch;
        
        // Category Filter
        return i.category === currentFilter && matchesSearch;
    });

    if (items.length === 0) {
        listDiv.innerHTML = '<p style="text-align:center; width:100%; color:#94a3b8; margin-top:50px;">No items found.</p>';
        return;
    }

    // Icon Map
    const icons = {
        social: 'fa-globe', bank: 'fa-wallet', home: 'fa-home', work: 'fa-briefcase',
        wireless: 'fa-wifi', tv: 'fa-tv', auto: 'fa-car', insurance: 'fa-file-contract',
        other: 'fa-key'
    };

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'card';
        
        // Favorite Active Class Check
        const starClass = item.isFav ? 'fas text-yellow' : 'far';
        
        div.innerHTML = `
            <div class="card-header">
                <div class="cat-icon"><i class="fas ${icons[item.category] || 'fa-key'}"></i></div>
                
                <div class="card-title-wrap" style="flex-grow:1; margin-left:15px;">
                    <div class="card-title">${item.title}</div>
                    <div class="card-user">${item.username || 'No Username'}</div>
                </div>

                <div class="card-actions">
                    <!-- ★ Favorite Button Added Here ★ -->
                    <button onclick="toggleFav('${item.id}')" title="Favorite">
                        <i class="${starClass} fa-star" style="font-size:16px;"></i>
                    </button>

                    <button onclick="editItem('${item.id}')" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    
                    <button onclick="deleteItem('${item.id}')" title="Delete" style="color:#EF4444;">
                        <i class="fas fa-trash"></i>
                    </button>
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

    // အဟောင်းရှိရင် Fav status ကို ပြန်ယူမယ် (မပျောက်အောင်)
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
    span.classList.toggle('blur'); span.classList.toggle('no-blur');
}
function genPass() {
    document.getElementById('inp-pass').value = Math.random().toString(36).slice(-8);
}

function openModal() { document.getElementById('entry-modal').style.display = 'flex'; }
function closeModal() { document.getElementById('entry-modal').style.display = 'none'; }

// --- GUIDE & PRIVACY TABS ---
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
    
    document.getElementById('tab-'+tabName).classList.add('active');
    // Highlight button logic
    const btns = document.querySelectorAll('.tab-link');
    if(tabName === 'manual') btns[0].classList.add('active');
    else btns[1].classList.add('active');
}

// Modal Functions (Update)
function openGuide() { 
    document.getElementById('guide-modal').style.display = 'flex'; 
    switchTab('manual');
}
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