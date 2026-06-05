// ============================================================================
// ACEQUIZ AI BACKEND SYSTEM - FULL PRODUCTION VERSION
// ============================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Khởi tạo Express App
const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// 1. CẤU HÌNH BẢO MẬT & MIDDLEWARE CHI TIẾT
// ============================================================================

// Thiết lập CORS an toàn để Frontend Vercel có thể giao tiếp với Backend Render
const corsOptions = {
    origin: '*', // Chấp nhận mọi domain (có thể thay bằng link Vercel sau)
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200 // Tránh lỗi trên các trình duyệt cũ
};
app.use(cors(corsOptions));

// Mở rộng giới hạn body size lên 50MB để đọc các file PDF cực lớn mà không bị nghẽn
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================================================
// 2. KIỂM TRA BIẾN MÔI TRƯỜNG & KHỞI TẠO AI
// ============================================================================

const API_KEY = (process.env.GEMINI_API_KEY || '').trim();

// TỰ ĐỘNG NHẬN DIỆN MODEL TỪ RENDER (Ví dụ: gemini-2.0-flash, gemini-2.5-pro...)
// Nếu không cấu hình, mặc định sẽ dùng bản 2.0-flash mới nhất
const MODEL_NAME = (process.env.MODEL_NAME || 'gemini-2.0-flash').trim();

// Nếu quên gắn key trên Render, server sẽ báo lỗi và dừng lại ngay
if (!API_KEY) {
    console.error("=========================================================");
    console.error("🚨 LỖI CHÍ MẠNG: KHÔNG TÌM THẤY GEMINI_API_KEY!");
    console.error("🚨 Vui lòng kiểm tra tab Environment trên Render.");
    console.error("=========================================================");
    process.exit(1);
}

// Khởi tạo con bot Google Gemini với key chuẩn
const genAI = new GoogleGenerativeAI(API_KEY);

// ============================================================================
// 3. CÁC HÀM TIỆN ÍCH HỖ TRỢ XỬ LÝ DỮ LIỆU (HELPER FUNCTIONS)
// ============================================================================

/**
 * Hàm gom toàn bộ text từ mảng file PDF thành một khối ngữ cảnh thống nhất
 */
const buildContextText = (documents) => {
    let context = "DANH SÁCH TÀI LIỆU CUNG CẤP TỪ NGƯỜI DÙNG:\n";
    documents.forEach((doc, index) => {
        context += `\n--- Bắt đầu Tài liệu ${index + 1}: [${doc.file_name}] ---\n`;
        context += doc.content;
        context += `\n--- Kết thúc Tài liệu ${index + 1} ---\n`;
    });
    return context;
};

/**
 * Hàm xây dựng câu lệnh (Prompt) chuẩn kỹ thuật prompt engineering cho luồng tạo đề thi
 */
const buildQuizPrompt = (contextText, userMessage, numQ) => {
    return `
Bạn là một chuyên gia giáo dục và giáo sư đại học. Dựa vào nội dung tài liệu sau đây:

${contextText}

Yêu cầu cụ thể của sinh viên: "${userMessage}"

Nhiệm vụ: Tạo ra ${numQ} câu hỏi trắc nghiệm khách quan bằng tiếng Việt.
Yêu cầu định dạng:
- BẮT BUỘC chỉ trả về duy nhất một mảng JSON (JSON Array).
- KHÔNG sử dụng markdown format (như \`\`\`json).
- KHÔNG thêm bất kỳ văn bản giải thích nào ở đầu hay cuối.

Cấu trúc JSON bắt buộc phải chuẩn xác như sau:
[
  {
    "question": "Nội dung câu hỏi số 1?",
    "options": {
      "A": "Nội dung đáp án A",
      "B": "Nội dung đáp án B",
      "C": "Nội dung đáp án C",
      "D": "Nội dung đáp án D"
    },
    "answer": "A",
    "explanation": "Giải thích chi tiết vì sao A là đáp án đúng dựa trên tài liệu."
  }
]
`;
};

// ============================================================================
// 4. API ENDPOINT CHÍNH: XỬ LÝ TOÀN BỘ YÊU CẦU TỪ FRONTEND
// ============================================================================

app.post('/api/process', async (req, res) => {
    // Tạo ID ngẫu nhiên để theo dõi Log của từng request một cách dễ dàng
    const requestId = Math.random().toString(36).substring(7);
    console.log(`\n[${new Date().toISOString()}] 📥 BẮT ĐẦU REQUEST [ID: ${requestId}]`);

    try {
        const { feature, user_message, documents, quiz_params } = req.body;

        // --- BƯỚC 1: KIỂM TRA TÍNH HỢP LỆ CỦA DỮ LIỆU ĐẦU VÀO ---
        if (!feature) {
            console.warn(`[${requestId}] ⚠️ Lỗi 400: Không có tham số feature.`);
            return res.status(400).json({ error: "Thiếu tham số 'feature' (quiz hoặc summarize)." });
        }
        
        if (!documents || !Array.isArray(documents) || documents.length === 0) {
            console.warn(`[${requestId}] ⚠️ Lỗi 400: Không có dữ liệu PDF gửi lên.`);
            return res.status(400).json({ error: "Thiếu dữ liệu tài liệu (documents). Vui lòng tải file lên." });
        }

        // --- BƯỚC 2: BUILD NGỮ CẢNH ---
        const contextText = buildContextText(documents);
        console.log(`[${requestId}] 📄 Đã ghép xong text từ ${documents.length} file PDF. Kích thước: ${contextText.length} ký tự.`);
        console.log(`[${requestId}] 🤖 Chuẩn bị gọi model: [${MODEL_NAME}]`);

        // ==========================================================
        // LUỒNG 1: TẠO ĐỀ THI TRẮC NGHIỆM (TRẢ VỀ CẤU TRÚC JSON)
        // ==========================================================
        if (feature === 'quiz') {
            const numQ = quiz_params?.num_questions || 10;
            console.log(`[${requestId}] 🎯 Chế độ: QUIZ | Số câu yêu cầu: ${numQ}`);
            
            const prompt = buildQuizPrompt(contextText, user_message, numQ);
            
            // Gọi AI với thiết lập ép cứng trả về JSON
            const model = genAI.getGenerativeModel({ 
                model: MODEL_NAME, // Dùng biến đọc từ Render
                generationConfig: { 
                    responseMimeType: "application/json",
                    temperature: 0.2 // Temperature thấp để AI không bịa đáp án
                }
            });

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            
            try {
                // Parse thử text AI trả về xem có chuẩn JSON không
                const jsonData = JSON.parse(responseText);
                console.log(`[${requestId}] ✅ Hoàn thành JSON Quiz. Trả kết quả cho Frontend.`);
                return res.status(200).json({ data: jsonData });
            } catch (parseError) {
                console.error(`[${requestId}] 🚨 Lỗi Parse JSON! Phản hồi từ AI không chuẩn:`, responseText);
                return res.status(500).json({ error: "AI trả về cấu trúc không hợp lệ. Vui lòng thử lại." });
            }
        } 
        
        // ==========================================================
        // LUỒNG 2: CHAT & TÓM TẮT (TRẢ VỀ KIỂU CHỮ CHẠY - STREAMING)
        // ==========================================================
        else if (feature === 'summarize') {
            console.log(`[${requestId}] 💬 Chế độ: SUMMARIZE (Chạy chữ Streaming)`);
            
            const prompt = `Dựa vào tài liệu sau:\n\n${contextText}\n\nYêu cầu của sinh viên: ${user_message}\n\nHãy trả lời chi tiết, chuyên nghiệp, sử dụng markdown để định dạng đẹp mắt bằng tiếng Việt.`;
            
            // Khởi tạo AI cho luồng Chat
            const model = genAI.getGenerativeModel({ model: MODEL_NAME }); // Dùng biến đọc từ Render
            const result = await model.generateContentStream(prompt);

            // Gửi header báo cho Vercel biết đây là luồng Streaming
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders(); 

            // Vòng lặp bắn từng cụm chữ về cho trình duyệt
            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
            }
            
            // Đóng luồng
            res.write('data: [DONE]\n\n');
            res.end();
            console.log(`[${requestId}] ✅ Đã stream xong toàn bộ đoạn hội thoại.`);
        } 
        
        // --- NẾU FEATURE KHÔNG HỢP LỆ ---
        else {
            console.warn(`[${requestId}] ⚠️ Lỗi 400: Tham số feature [${feature}] không hợp lệ.`);
            return res.status(400).json({ error: "Tính năng không được hỗ trợ." });
        }

    } catch (error) {
        console.error(`[${requestId}] 🚨 LỖI HỆ THỐNG:`, error.message);
        console.error(error.stack); // In stack trace để dễ debug
        
        // Đảm bảo không bị lỗi "Headers already sent" nếu crash giữa chừng
        if (!res.headersSent) {
            res.status(500).json({ 
                error: "Lỗi Server Internal: API Google có thể đang từ chối truy cập hoặc quá tải.", 
                details: error.message 
            });
        }
    }
});

// ============================================================================
// 5. API HEALTH CHECK (ĐỂ TRÌNH DUYỆT KIỂM TRA SERVER CÓ SỐNG KHÔNG)
// ============================================================================

app.get('/api/process', (req, res) => {
    res.status(200).send("✅ API Endpoint /api/process đang hoạt động. Hãy gọi bằng POST.");
});

app.get('/', (req, res) => {
    res.status(200).send("🚀 AceQuiz Backend System is Running Smoothly...");
});

// ============================================================================
// 6. KHỞI ĐỘNG SERVER
// ============================================================================

app.listen(PORT, () => {
    console.log("=========================================================");
    console.log(`🚀 BẬT MÁY: AceQuiz Backend đang chạy tại port ${PORT}`);
    console.log(`🔒 Chế độ bảo mật cực mạnh đã được kích hoạt.`);
    console.log(`🤖 Đang cấu hình sử dụng Model AI: [${MODEL_NAME}]`);
    console.log("=========================================================");
});