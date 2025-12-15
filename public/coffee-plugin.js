/**
 * ☕ Buy Me A Coffee Plugin (Stripe)
 * Apps တိုင်းမှာ အလွယ်တကူ ထည့်သုံးနိုင်သော Plugin
 */

// ==========================================
// 1. CONFIGURATION (ဒီနေရာမှာ Link ပြောင်းပါ)
// ==========================================
const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/5kQ28r5fCa9E8pj9VE1B601"; // <--- သင့် Link ထည့်ပါ

// ==========================================
// 2. INJECT CSS STYLES
// ==========================================
const coffeeStyle = document.createElement("style");
coffeeStyle.innerHTML = `
    /* --- Main Button Design --- */
    .coffee-btn-icon {
        /* 1. Size ချိန်ညှိခြင်း (၄၅px သို့ ၅၀px ထားနိုင်သည်) */
        width: 50px;
        height: 50px;
        
        /* 2. နောက်ခံအရောင် (Steam ပေါ်အောင် အညိုရောင်ထားသည်) */
        background: linear-gradient(135deg, #6F4E37 0%, #8B5E3C 100%); 
        /* အဖြူလိုချင်ရင် -> background: #ffffff; လို့ပြောင်းပါ */

        border-radius: 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        
        /* အရိပ် */
        box-shadow: 0 4px 15px rgba(111, 78, 55, 0.4);
        border: 2px solid #ffffff;
        
        position: relative;
        z-index: 1000;
        transition: transform 0.3s ease;
    }

    /* Icon Font Size */
    .coffee-emoji {
        font-size: 24px; /* ပုံကိုလည်း အချိုးကျ သေးလိုက်သည် */
        line-height: 1;
        display: block;
        transform: translateY(2px);
        filter: drop-shadow(0 2px 2px rgba(0,0,0,0.2));
    }

    /* --- Steam Animation (ကော်ဖီအငွေ့) --- */
    .coffee-btn-icon::before,
    .coffee-btn-icon::after {
        content: "";
        position: absolute;
        top: -10px;
        width: 4px;
        height: 10px;
        background: rgba(255, 255, 255, 0.8); /* အငွေ့အရောင် (အဖြူ) */
        border-radius: 50%;
        opacity: 0;
        z-index: -1;
    }

    /* ဘယ်ဘက်အငွေ့ */
    .coffee-btn-icon::before {
        left: 18px;
        animation: steamRise 2s infinite ease-out;
    }

    /* ညာဘက်အငွေ့ (နည်းနည်းနောက်ကျမှထွက်မယ်) */
    .coffee-btn-icon::after {
        right: 18px;
        animation: steamRise 2s infinite ease-out 0.8s;
    }

    @keyframes steamRise {
        0% { transform: translateY(0) scale(1); opacity: 0; }
        50% { opacity: 0.8; }
        100% { transform: translateY(-15px) scale(1.5); opacity: 0; }
    }

    /* Hover Effect */
    .coffee-btn-icon:hover {
        transform: scale(1.1); /* မောက်စ်တင်ရင် ကြီးလာမယ် */
        box-shadow: 0 6px 20px rgba(111, 78, 55, 0.6);
    }

    /* --- Modal Styles (Same as before) --- */
    .coffee-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(5px);
        z-index: 99999; display: none; justify-content: center; align-items: center;
        opacity: 0; transition: opacity 0.3s ease;
    }
    .coffee-overlay.active { opacity: 1; }

    .coffee-modal {
        background: white; width: 90%; max-width: 350px;
        border-radius: 24px; padding: 30px; text-align: center; position: relative;
        box-shadow: 0 20px 50px rgba(0,0,0,0.3);
        transform: scale(0.8); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .coffee-overlay.active .coffee-modal { transform: scale(1); }

    .coffee-close {
        position: absolute; top: 15px; right: 15px; width: 30px; height: 30px;
        background: #F3F4F6; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        cursor: pointer; color: #6B7280; font-size: 18px; transition: 0.2s;
    }
    .coffee-close:hover { background: #EF4444; color: white; }

    .btn-stripe-pay {
        background: #635BFF; color: white; width: 100%; padding: 14px;
        border: none; border-radius: 12px; font-size: 16px; font-weight: 600;
        cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 8px;
        text-decoration: none; transition: background 0.2s; margin-top: 20px;
    }
    .btn-stripe-pay:hover { background: #4B4ACF; }
`;
document.head.appendChild(coffeeStyle);

// ==========================================
// 3. INJECT HTML MODAL
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    const modalHTML = `
        <div id="coffee-modal-overlay" class="coffee-overlay">
            <div class="coffee-modal">
                <div class="coffee-close" onclick="closePaymentUI()">&times;</div>
                <div style="font-size: 50px; margin-bottom: 10px;">☕</div>
                <h2 style="font-size: 20px; margin-bottom: 10px; color: #1F2937;">Buy me a Coffee</h2>
                <p style="color: #6B7280; font-size: 14px; line-height: 1.5;">
                    Support the developer to keep this app alive! 💖
                </p>
                <a href="${STRIPE_PAYMENT_LINK}" target="_blank" class="btn-stripe-pay">
                    Donate via Stripe <i class="fas fa-arrow-right"></i>
                </a>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML("beforeend", modalHTML);
});

// ==========================================
// 4. GLOBAL FUNCTIONS
// ==========================================
window.openPaymentUI = function() {
    const overlay = document.getElementById("coffee-modal-overlay");
    if(overlay) {
        overlay.style.display = "flex";
        setTimeout(() => overlay.classList.add("active"), 10);
    }
}

window.closePaymentUI = function() {
    const overlay = document.getElementById("coffee-modal-overlay");
    if(overlay) {
        overlay.classList.remove("active");
        setTimeout(() => overlay.style.display = "none", 300);
    }
}

window.addEventListener("click", (e) => {
    const overlay = document.getElementById("coffee-modal-overlay");
    if (e.target === overlay) window.closePaymentUI();
});