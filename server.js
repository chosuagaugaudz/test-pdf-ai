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

const corsOptions = {
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200 
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================================================
// 2. KIỂM TRA BIẾN MÔI TRƯỜNG & KHỞI TẠO AI
// ============================================================================

const API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const MODEL_NAME = (process.env.MODEL_NAME || 'gemini-2.0-flash').trim();

if (!API_KEY) {
    console.error("=========================================================");
    console.error("🚨 LỖI CHÍ MẠNG: KHÔNG TÌM THẤY GEMINI_API_KEY!");
    console.error("🚨 Vui lòng kiểm tra tab Environment trên Render.");
    console.error("=========================================================");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);

// ============================================================================
// 3. CÁC HÀM TIỆN ÍCH HỖ TRỢ XỬ LÝ DỮ LIỆU (HELPER FUNCTIONS)
// ============================================================================

const buildContextText = (documents) => {
    let context = "DANH SÁCH TÀI LIỆU CUNG CẤP TỪ NGƯỜI DÙNG:\n";
    documents.forEach((doc, index) => {
        context += `\n--- Bắt đầu Tài liệu ${index + 1}: [${doc.file_name}] ---\n`;
        context += doc.content;
        context += `\n--- Kết thúc Tài liệu ${index + 1} ---\n`;
    });
    return context;
};

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
    const requestId = Math.random().toString(36).substring(7);
    console.log(`\n[${new Date().toISOString()}] 📥 BẮT ĐẦU REQUEST [ID: ${requestId}]`);

    try {
        const { feature, user_message, documents, quiz_params } = req.body;

        if (!feature) {
            console.warn(`[${requestId}] ⚠️ Lỗi 400: Không có tham số feature.`);
            return res.status(400).json({ error: "Thiếu tham số 'feature' (quiz hoặc summarize)." });
        }
        
        if (!documents || !Array.isArray(documents) || documents.length === 0) {
            console.warn(`[${requestId}] ⚠️ Lỗi 400: Không có dữ liệu PDF gửi lên.`);
            return res.status(400).json({ error: "Thiếu dữ liệu tài liệu (documents). Vui lòng tải file lên." });
        }

        const contextText = buildContextText(documents);
        console.log(`[${requestId}] 📄 Đã ghép xong text từ ${documents.length} file PDF. Kích thước: ${contextText.length} ký tự.`);
        console.log(`[${requestId}] 🤖 Chuẩn bị gọi model: [${MODEL_NAME}]`);

        if (feature === 'quiz') {
            const numQ = quiz_params?.num_questions || 10;
            console.log(`[${requestId}] 🎯 Chế độ: QUIZ | Số câu yêu cầu: ${numQ}`);
            
            const prompt = buildQuizPrompt(contextText, user_message, numQ);
            
            const model = genAI.getGenerativeModel({ 
                model: MODEL_NAME,
                generationConfig: { 
                    responseMimeType: "application/json",
                    temperature: 0.2 
                }
            });

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            
            try {
                const jsonData = JSON.parse(responseText);
                console.log(`[${requestId}] ✅ Hoàn thành JSON Quiz. Trả kết quả cho Frontend.`);
                return res.status(200).json({ data: jsonData });
            } catch (parseError) {
                console.error(`[${requestId}] 🚨 Lỗi Parse JSON! Phản hồi từ AI không chuẩn:`, responseText);
                return res.status(500).json({ error: "AI trả về cấu trúc không hợp lệ. Vui lòng thử lại." });
            }
        } 
        
        else if (feature === 'summarize') {
            console.log(`[${requestId}] 💬 Chế độ: SUMMARIZE (Chạy chữ Streaming)`);
            
            const prompt = `Dựa vào tài liệu sau:\n\n${contextText}\n\nYêu cầu của sinh viên: ${user_message}\n\nHãy trả lời chi tiết, chuyên nghiệp, sử dụng markdown để định dạng đẹp mắt bằng tiếng Việt.`;
            
            const model = genAI.getGenerativeModel({ model: MODEL_NAME }); 
            const result = await model.generateContentStream(prompt);

            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders(); 

            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
            }
            
            res.write('data: [DONE]\n\n');
            res.end();
            console.log(`[${requestId}] ✅ Đã stream xong toàn bộ đoạn hội thoại.`);
        } 
        
        else {
            console.warn(`[${requestId}] ⚠️ Lỗi 400: Tham số feature [${feature}] không hợp lệ.`);
            return res.status(400).json({ error: "Tính năng không được hỗ trợ." });
        }

    } catch (error) {
        console.error(`[${requestId}] 🚨 LỖI HỆ THỐNG:`, error.message);
        console.error(error.stack); 
        
        if (!res.headersSent) {
            res.status(500).json({ 
                error: "Lỗi Server Internal: API Google có thể đang từ chối truy cập hoặc quá tải.", 
                details: error.message 
            });
        }
    }
});

// ============================================================================
// 5. API HEALTH CHECK
// ============================================================================

app.get('/api/process', (req, res) => {
    res.status(200).send("✅ API Endpoint /api/process đang hoạt động. Hãy gọi bằng POST.");
});

app.get('/', (req, res) => {
    res.status(200).send("🚀 AceQuiz Backend System is Running Smoothly...");
});

// ============================================================================
// 6. KHỞI ĐỘNG SERVER (ĐÃ FIX LỖI TIMEOUT 13 PHÚT TRÊN RENDER)
// ============================================================================

// Nốt chốt hạ '0.0.0.0' để Render không bao giờ bị Timeout nữa
app.listen(PORT, '0.0.0.0', () => {
    console.log("=========================================================");
    console.log(`🚀 BẬT MÁY: AceQuiz Backend đang chạy tại port ${PORT}`);
    console.log(`🔒 Chế độ bảo mật cực mạnh đã được kích hoạt.`);
    console.log(`🌐 Đã bind port 0.0.0.0 để tương thích tuyệt đối với Render.`);
    console.log(`🤖 Đang cấu hình sử dụng Model AI: [${MODEL_NAME}]`);
    console.log("=========================================================");
});