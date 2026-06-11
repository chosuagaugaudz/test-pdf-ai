require('dotenv').config();

const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
const MAX_RETRIES = 2; // total 3 attempts per model

const executeWithFallback = async (actionFn) => {
    for (let modelIndex = 0; modelIndex < FALLBACK_MODELS.length; modelIndex++) {
        const modelName = FALLBACK_MODELS[modelIndex];
        console.log(`[MODEL] Trying ${modelName}`);

        for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
            try {
                // Thử chạy logic được truyền vào với model hiện tại
                const result = await actionFn(modelName);
                console.log(`[MODEL] Success`);
                return result; 
            } catch (error) {
                const status = error.status || (error.response && error.response.status);
                const isRetryable = status === 503 || status === 429 || (status >= 500) || 
                                    (error.message && (error.message.includes('503') || error.message.includes('429')));
                
                if (isRetryable) {
                    console.log(`[MODEL] ${status || '503'} received`);
                    
                    if (attempt <= MAX_RETRIES) {
                        console.log(`[MODEL] Retrying...`);
                        const backoffTime = Math.pow(2, attempt - 1) * 100; // Nhanh hơn cho testing: 100ms, 200ms
                        await new Promise(r => setTimeout(r, backoffTime));
                    } else {
                        // Hết lượt retry cho model này, chuẩn bị chuyển sang model kế tiếp
                        if (modelIndex < FALLBACK_MODELS.length - 1) {
                            console.log(`[MODEL] Switching to ${FALLBACK_MODELS[modelIndex + 1]}`);
                        }
                    }
                } else {
                    // Nếu lỗi client (như 400 Bad Request, 401 Unauthorized), văng lỗi ngay lập tức
                    throw error;
                }
            }
        }
    }
    // Nếu chạy qua toàn bộ list model mà vẫn lỗi
    throw new Error("Tất cả hệ thống AI đều đang quá tải. Vui lòng thử lại sau.");
};

(async () => {
    console.log("=== BẮT ĐẦU SIMULATE LỖI 503 CHO gemini-2.5-flash ===");
    try {
        const result = await executeWithFallback(async (modelName) => {
            if (modelName === 'gemini-2.5-flash') {
                // Giả lập lỗi 503 Unavailable do server Google quá tải
                const error = new Error("Simulated 503 Unavailable");
                error.status = 503;
                throw error;
            } else {
                // Trả về kết quả thành công cho model thay thế
                return "Mock Content từ " + modelName;
            }
        });
        console.log(`Kết quả lấy được: ${result}`);
        console.log("=== SIMULATION COMPLETED SUCCESSFULLY ===");
    } catch (e) {
        console.error("Simulation failed:", e.message);
    }
})();
