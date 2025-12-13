// --- 1. CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBKve-zt2uXcOebXvpSPOZt4ZRRL7Esqgk",
  authDomain: "lifemanager-mm.firebaseapp.com",
  projectId: "lifemanager-mm",
  storageBucket: "lifemanager-mm.firebasestorage.app",
  messagingSenderId: "582617327472",
  appId: "1:582617327472:web:194b114249e69a273bd1b5",
  measurementId: "G-V1QK1VMVDT"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.setCustomParameters({ prompt: 'select_account consent' });

// Global Vars
let gDriveToken = localStorage.getItem("vaultToken");
let driveFileId = null;
const DATA_FILE_NAME = 'my_secure_vault.json';
let vaultData = []; // Encrypted data from drive
let decryptedVault = []; // Decrypted usable data
let MASTER_KEY = null; // Memory only (Reset on refresh)
let currentFilter = 'all';

// --- 2. AUTHENTICATION ---
auth.onAuthStateChanged((user) => {
    if (user && gDriveToken) {
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('user-display').innerText = user.displayName;
        // User ဝင်ပြီးတာနဲ့ Master Password တောင်းမယ်
        document.getElementById('master-screen').style.display = 'flex';
    } else {
        document.getElementById('auth-screen').style.display = 'flex';
    }
});

function googleLogin() {
    auth.signInWithPopup(provider).then((result) => {
        gDriveToken = result.credential.accessToken;
        localStorage.setItem("vaultToken", gDriveToken);
        location.reload();
    }).catch(err => alert(err.message));
}

function logout() {
    auth.signOut().then(() => {
        localStorage.removeItem("vaultToken");
        location.reload();
    });
}

// --- 3. MASTER PASSWORD & ENCRYPTION ---
async function unlockVault() {
    const input = document.getElementById('master-pass');
    const pass = input.value;
    if(!pass) return alert("Please enter Master Password");

    // Show Loading
    const btn = document.querySelector('#master-screen button');
    btn.innerText = "Decrypting...";
    btn.disabled = true;

    try {
        // 1. Fetch Encrypted File from Drive
        await initDriveSync();
        
        // 2. Try Decrypt
        if(vaultData.length > 0) {
            // Check if password works by trying to decrypt first item
            // Note: In real app, we might store a hash to verify password
            const testDec = CryptoJS.AES.decrypt(vaultData[0].data, pass).toString(CryptoJS.enc.Utf8);
            
            if(!testDec) throw new Error("Wrong Password");
            
            // Success: Decrypt All
            decryptedVault = vaultData.map(item => {
                const jsonStr = CryptoJS.AES.decrypt(item.data, pass).toString(CryptoJS.enc.Utf8);
                return JSON.parse(jsonStr);
            });
        } else {
            // New Vault
            decryptedVault = [];
        }

        // 3. Save Key to Memory (RAM only)
        MASTER_KEY = pass;
        
        // 4. Enter App
        document.getElementById('master-screen').style.display = 'none';
        document.getElementById('app-screen').style.display = 'flex';
        renderItems();

    } catch (e) {
        console.error(e);
        alert("Incorrect Master Password or Corrupt Data.");
        btn.innerText = "Unlock";
        btn.disabled = false;
    }
}

// --- 4. DRIVE SYNC ---
async function initDriveSync() {
    document.getElementById('loader').style.display = 'block';
    
    // Find File
    const q = `name = '${DATA_FILE_NAME}' and trashed = false`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
        headers: { 'Authorization': `Bearer ${gDriveToken}` }
    });
    const result = await res.json();

    if (result.files && result.files.length > 0) {
        driveFileId = result.files[0].id;
        const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${gDriveToken}` }
        });
        vaultData = await fileRes.json();
    } else {
        // Create New File
        const metadata = { name: DATA_FILE_NAME, mimeType: 'application/json' };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([JSON.stringify([])], { type: 'application/json' })); // Empty array

        const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${gDriveToken}` },
            body: form
        });
        const newFile = await createRes.json();
        driveFileId = newFile.id;
        vaultData = [];
    }
    document.getElementById('loader').style.display = 'none';
}

async function syncToDrive() {
    document.getElementById('loader').style.display = 'block';
    
    // Encrypt Data before saving
    const encryptedData = decryptedVault.map(item => {
        return {
            id: item.id,
            data: CryptoJS.AES.encrypt(JSON.stringify(item), MASTER_KEY).toString()
        };
    });

    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 
            'Authorization': `Bearer ${gDriveToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(encryptedData)
    });
    document.getElementById('loader').style.display = 'none';
}

// --- 5. APP LOGIC ---
function renderItems() {
    const grid = document.getElementById('vault-grid');
    const search = document.getElementById('search-input').value.toLowerCase();
    grid.innerHTML = '';

    let items = decryptedVault;

    // Filter Category
    if(currentFilter === 'fav') items = items.filter(i => i.isFav);
    else if(currentFilter !== 'all') items = items.filter(i => i.category === currentFilter);

    // Filter Search
    items = items.filter(i => i.title.toLowerCase().includes(search) || i.username.toLowerCase().includes(search));

    items.forEach(item => {
        const iconMap = {
            home: 'fa-home', bank: 'fa-university', car: 'fa-car',
            work: 'fa-briefcase', health: 'fa-heartbeat', social: 'fa-globe', other: 'fa-lock'
        };

        const div = document.createElement('div');
        div.className = 'vault-card';
        div.innerHTML = `
            <div class="card-header">
                <div class="card-icon"><i class="fas ${iconMap[item.category] || 'fa-lock'}"></i></div>
                <div class="card-actions">
                    <button class="btn-icon btn-fav ${item.isFav?'active':''}" onclick="toggleFav('${item.id}')"><i class="fas fa-star"></i></button>
                    <button class="btn-icon" onclick="editItem('${item.id}')"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon" onclick="deleteItem('${item.id}')" style="color:red;"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div class="card-title">${item.title}</div>
            <div class="card-user"><i class="fas fa-user"></i> ${item.username}</div>
            
            <div class="secret-field">
                <span>PASS:</span>
                <span class="secret-val blurred" onclick="toggleBlur(this)">${item.password}</span>
                <i class="far fa-copy" onclick="copyText('${item.password}')" style="cursor:pointer"></i>
            </div>
            
            ${item.securityQ ? `
            <div class="secret-field" style="margin-top:5px; font-size:12px;">
                <span>SEC:</span>
                <span class="secret-val blurred" onclick="toggleBlur(this)">${item.securityQ}</span>
            </div>` : ''}
        `;
        grid.appendChild(div);
    });
}

// Actions
function saveItem() {
    const id = document.getElementById('edit-id').value;
    const title = document.getElementById('inp-title').value;
    const user = document.getElementById('inp-user').value;
    const pass = document.getElementById('inp-pass').value;
    
    if(!title || !user || !pass) return alert("Please fill Title, Username and Password");

    const newItem = {
        id: id || Date.now().toString(),
        category: document.getElementById('inp-cat').value,
        title, username: user, password: pass,
        securityQ: document.getElementById('inp-sec').value,
        url: document.getElementById('inp-url').value,
        isFav: false
    };

    if(id) {
        const idx = decryptedVault.findIndex(i => i.id === id);
        newItem.isFav = decryptedVault[idx].isFav; // preserve fav
        decryptedVault[idx] = newItem;
    } else {
        decryptedVault.unshift(newItem);
    }

    closeModal();
    renderItems();
    syncToDrive();
}

function deleteItem(id) {
    if(confirm("Delete this account?")) {
        decryptedVault = decryptedVault.filter(i => i.id !== id);
        renderItems();
        syncToDrive();
    }
}

function toggleFav(id) {
    const item = decryptedVault.find(i => i.id === id);
    item.isFav = !item.isFav;
    renderItems();
    syncToDrive();
}

function filterCategory(cat) {
    currentFilter = cat;
    document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
    renderItems();
}

// Helpers
function openModal() { document.getElementById('item-modal').style.display = 'flex'; clearForm(); }
function closeModal() { document.getElementById('item-modal').style.display = 'none'; }
function clearForm() {
    document.getElementById('edit-id').value = '';
    document.getElementById('inp-title').value = '';
    document.getElementById('inp-user').value = '';
    document.getElementById('inp-pass').value = '';
    document.getElementById('inp-sec').value = '';
    document.getElementById('inp-url').value = '';
}
function editItem(id) {
    const item = decryptedVault.find(i => i.id === id);
    document.getElementById('edit-id').value = item.id;
    document.getElementById('inp-cat').value = item.category;
    document.getElementById('inp-title').value = item.title;
    document.getElementById('inp-user').value = item.username;
    document.getElementById('inp-pass').value = item.password;
    document.getElementById('inp-sec').value = item.securityQ;
    document.getElementById('inp-url').value = item.url;
    document.getElementById('item-modal').style.display = 'flex';
}
function toggleBlur(el) { el.classList.toggle('blurred'); }
function copyText(txt) { navigator.clipboard.writeText(txt); alert("Copied!"); }
function togglePass(id) {
    const x = document.getElementById(id);
    x.type = x.type === "password" ? "text" : "password";
}
function generateStrongPass() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()";
    let pass = "";
    for (let i = 0; i < 16; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    document.getElementById('inp-pass').value = pass;
}