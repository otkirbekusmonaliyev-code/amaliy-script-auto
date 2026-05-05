const fetch = require('node-fetch');
const fs = require('fs');

async function testUsers() {
    console.log("🚀 Test boshlandi...");

    // JSON faylni o'qish
    let users;
    try {
        const data = fs.readFileSync('nimadir.json', 'utf8');
        users = JSON.parse(data);
    } catch (err) {
        console.error("❌ Faylni o'qishda xatolik:", err.message);
        return;
    }

    const BASE_URL = "https://dev.api.lms.itechacademy.uz/api/auth";
    const LOGIN_URL = `${BASE_URL}/login`;
    const LOGOUT_URL = `${BASE_URL}/logout`; // Logout manzili odatda shunday bo'ladi

    const results = {};
    let successCount = 0;
    let errorCount = 0;

    for (const role in users) {
        const user = users[role];
        console.log(`\n--- [${role.toUpperCase()}] tekshirilmoqda ---`);

        try {
            // 1. LOGIN QISMI
            const loginResponse = await fetch(LOGIN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: user.phone,
                    password: user.password
                })
            });

            const loginData = await loginResponse.json();

            if (loginResponse.ok) {
                console.log("✅ Login muvaffaqiyatli!");
                
                const token = loginData.access_token || loginData.token || (loginData.data && loginData.data.token);

                if (token) {
                    console.log("🔑 Token olindi.");

                    // 2. LOGOUT QISMI (Token orqali)
                    try {
                        const logoutResponse = await fetch(LOGOUT_URL, {
                            method: 'POST', // Yoki API hujjatiga qarab GET
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            }
                        });

                        if (logoutResponse.ok) {
                            console.log("🚪 Logout muvaffaqiyatli bajarildi.");
                        } else {
                            console.log("⚠️ Logoutda xatolik (lekin login ishladi).");
                        }
                    } catch (e) {
                        console.log("📡 Logout so'rovida xatolik.");
                    }
                }

                results[role] = "to'g'ri";
                successCount++;

            } else {
                console.log(`❌ Xato status: ${loginResponse.status}`);
                console.log("💬 Server javobi:", loginData.message || loginData);
                results[role] = "xato";
                errorCount++;
            }

        } catch (error) {
            console.log("🌐 Serverga ulanishda xatolik:", error.message);
            results[role] = "xato";
            errorCount++;
        }
    }

    // Natijalarni chiqarish
    console.log("\n" + "=".repeat(30));
    console.log("🏁 Barcha ishlar tugadi!");
    console.log("📊 Qisqa natijalar:");
    console.table(results); // Chiroyli jadval ko'rinishida chiqaradi

    console.log(`✅ To'g'ri: ${successCount}`);
    console.log(`❌ Xato: ${errorCount}`);
}

testUsers();