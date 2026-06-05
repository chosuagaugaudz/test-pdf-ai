require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// 1. CẤU HÌNH BẢO MẬT & MIDDLEWARE (CHUẨN PRODUCTION)
// ============================================================================

// Thiết lập CORS an toàn, chỉ cho phép các domain được chỉ định (hoặc mở tạm thời cho mọi nguồn)
const corsOptions = {
    origin: '*', // Tạm mở để Vercel gọi thoải mái, sau này có thể fix cứng link Vercel vào đây
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Giới hạn dung lượng nhận vào (50MB để đọc các file PDF text cực dài)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================================================
// 2. KHỞI TẠO GOOGLE GEMINI AI
// ============================================================================
const API_KEY = (process.env.GEMINI_API_KEY || '').trim();

if (!API_KEY) {
    console.error("=========================================================");
    console.error("🚨 FATAL ERROR: KHÔNG TÌM THẤY GEMINI_API_KEY!");
    console.error("🚨 Vui lòng kiểm tra lại tab Environment trên Render.");
    console.error("=========================================================");
    process.exit(1); // Ép server dừng lại nếu không có key để tránh lỗi ngầm
}

const genAI = new GoogleGenerativeAI(API_KEY);

// ============================================================================
// 3. CÁC HÀM TIỆN ÍCH (HELPER FUNCTIONS)
// ============================================================================

// Hàm xây dựng ngữ cảnh từ mảng documents
const buildContextText = (documents) => {
    let context = "DANH SÁCH TÀI LIỆU CUNG CẤP:\n";
    documents.forEach((doc, index) => {
        context += `\n--- Tài liệu ${index + 1}: [${doc.file_name}] ---\n`;
        context += doc.content;
        context += `\n--- Kết thúc tài liệu ${index + 1} ---\n`;
    });
    return context;
};

// Hàm tạo Prompt cho luồng Trắc nghiệm (Quiz)
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
// 4. API ENDPOINT CHÍNH (XỬ LÝ TOÀN BỘ LOGIC)
// ============================================================================

app.post('/api/process', async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[${new Date().toISOString()}] 📥 Nhận Request ID: ${requestId}`);

    try {
        const { feature, user_message, documents, quiz_params } = req.body;

        // --- VALIDATION: Kiểm tra dữ liệu cực kỳ chặt chẽ ---
        if (!feature) {
            return res.status(400).json({ error: "Thiếu tham số 'feature' (quiz hoặc summarize)." });
        }
        if (!documents || !Array.isArray(documents) || documents.length === 0) {
            console.warn(`[${requestId}] ⚠️ Lỗi 400: Frontend không gửi mảng documents.`);
            return res.status(400).json({ error: "Thiếu dữ liệu tài liệu (documents) từ Frontend gửi lên. Vui lòng check lại UI." });
        }

        const contextText = buildContextText(documents);
        console.log(`[${requestId}] 📄 Đã parse xong text từ ${documents.length} file PDF. Kích thước text: ${contextText.length} ký tự.`);

        // --- LUỒNG 1: TẠO ĐỀ THI TRẮC NGHIỆM (TRẢ VỀ JSON) ---
        if (feature === 'quiz') {
            const numQ = quiz_params?.num_questions || 10;
            console.log(`[${requestId}] 🎯 Chế độ: QUIZ | Số câu yêu cầu: ${numQ}`);
            
            const prompt = buildQuizPrompt(contextText, user_message, numQ);
            const model = genAI.getGenerativeModel({ 
                model: "gemini-1.5-flash",
                generationConfig: { 
                    responseMimeType: "application/json",
                    temperature: 0.2 // Giảm sự sáng tạo để AI bám sát tài liệu hơn
                }
            });

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            
            try {
                const jsonData = JSON.parse(responseText);
                console.log(`[${requestId}] ✅ Tạo JSON Quiz thành công.`);
                return res.status(200).json({ data: jsonData });
            } catch (parseError) {
                console.error(`[${requestId}] 🚨 Lỗi Parse JSON. Raw output:`, responseText);
                return res.status(500).json({ error: "AI trả về cấu trúc không hợp lệ. Vui lòng thử lại." });
            }
        } 
        
        // --- LUỒNG 2: CHAT & TÓM TẮT (TRẢ VỀ STREAMING TEXT) ---
        else if (feature === 'summarize') {
            console.log(`[${requestId}] 💬 Chế độ: SUMMARIZE/CHAT (Streaming)`);
            
            const prompt = `Dựa vào tài liệu sau:\n${contextText}\n\nYêu cầu: ${user_message}\nTrả lời chi tiết, chuyên nghiệp bằng tiếng Việt.`;
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContentStream(prompt);

            // Set Headers cho luồng stream liên tục
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders(); // Bắt buộc bắn header đi trước

            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                // Bắn từng cụm từ về cho Frontend V6
                res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
            }
            res.write('data: [DONE]\n\n');
            res.end();
            console.log(`[${requestId}] ✅ Đã stream xong toàn bộ text.`);
        } 
        
        else {
            return res.status(400).json({ error: "Tính năng không được hỗ trợ (feature không hợp lệ)." });
        }

    } catch (error) {
        console.error(`[${requestId}] 🚨 LỖI HỆ THỐNG:`, error.message);
        console.error(error.stack);
        
        // Nếu Header chưa gửi đi (luồng JSON), thì báo lỗi 500
        if (!res.headersSent) {
            res.status(500).json({ 
                error: "Lỗi Server Internal: API Google có thể đang quá tải hoặc gặp sự cố.", 
                details: error.message 
            });
        }
    }
});

// ============================================================================
// 5. HEALTH CHECK & KHỞI ĐỘNG SERVER
// ============================================================================

// Cổng GET để trình duyệt test ping xem server có "tỉnh" không
app.get('/api/process', (req, res) => {
    res.status(200).send("✅ API đang hoạt động! Hãy gửi request bằng phương thức POST.");
});
app.get('/', (req, res) => {
    res.status(200).send("AceQuiz Backend System is Running...");
});

app.listen(PORT, () => {
    console.log("=========================================================");
    console.log(`🚀 BẬT MÁY: AceQuiz Backend đang chạy tại port ${PORT}`);
    console.log(`🔒 Chế độ bảo vệ bằng CORS & Error Handling đã kích hoạt.`);
    console.log("=========================================================");
});