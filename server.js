// ============================================================================
// ACEQUIZ AI BACKEND SYSTEM - GOOGLE GEMINI 2.5 VERSION WITH FALLBACK
// ============================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

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

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      workerSrc: ["'self'", "blob:", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"]
    }
  }
}));

// Rate limiting: 100 requests per 15 minutes
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests from this IP, please try again later"
});
app.use(limiter);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files from the public directory
app.use(express.static('public'));

// ============================================================================
// 2. KIỂM TRA BIẾN MÔI TRƯỜNG & KHỞI TẠO AI
// ============================================================================

const API_KEY = (process.env.GEMINI_API_KEY || '').trim();

if (!API_KEY) {
    console.error("=========================================================");
    console.error("🚨 LỖI CHÍ MẠNG: KHÔNG TÌM THẤY GEMINI_API_KEY!");
    console.error("🚨 Vui lòng khai báo GEMINI_API_KEY trong file .env");
    console.error("=========================================================");
    process.exit(1);
}

// Khởi tạo SDK Google GenAI
const ai = new GoogleGenAI({ apiKey: API_KEY });

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
You are an educational assessment AI.
Your task is to generate quizzes, MCQs, flashcards, and exams ONLY from the academic learning content inside uploaded materials.

STRICT CONTENT FILTERING
Before generating questions, classify document content into:
ALLOWED CONTENT: Definitions, Concepts, Theories, Formulas, Models, Frameworks, Algorithms, Processes, Comparisons, Technical explanations, Learning objectives directly related to the subject, Examples used to explain concepts.
FORBIDDEN CONTENT: Never generate questions from Lecturer biography, Author biography, Instructor information, Contact information, Email addresses, Phone numbers, Course credits, Assessment percentages, Grading policies, Course schedule, Timetable, Office hours, References list, Copyright notices, Acknowledgements, Administrative information, Page numbers, Metadata.

If a section is not teaching the academic subject itself, ignore it completely.

QUESTION QUALITY RULES
Generate questions only from high-value educational content.
Prioritize: Core concepts, Definitions, Important terminology, Relationships between concepts, Comparisons, Processes and workflows, Exam-relevant knowledge.
Avoid trivial fact recall.

PAPER EXAM MODE (JSON OUTPUT)
Generate the entire exam at once: Questions, Options A/B/C/D, Answer key, Explanations.
BẮT BUỘC chỉ trả về duy nhất một mảng JSON (JSON Array).
KHÔNG sử dụng markdown format.
KHÔNG thêm bất kỳ văn bản giải thích nào ở đầu hay cuối ngoài định dạng JSON.

=========================================
DỮ LIỆU TÀI LIỆU CỦA NGƯỜI DÙNG:
${contextText}
=========================================

Yêu cầu cụ thể của sinh viên: "${userMessage}"

Nhiệm vụ: Dựa vào tài liệu trên, hãy tạo ra ${numQ} câu hỏi trắc nghiệm khách quan bằng tiếng Việt.

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
// 4. MODEL FALLBACK & RETRY UTILITY
// ============================================================================

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
                        const backoffTime = Math.pow(2, attempt - 1) * 1000; // Exponential Backoff: 1s, 2s
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

// ============================================================================
// 5. API ENDPOINT CHÍNH: XỬ LÝ TOÀN BỘ YÊU CẦU TỪ FRONTEND
// ============================================================================

app.post('/api/process', async (req, res) => {
    const requestId = crypto.randomUUID();
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

        if (feature === 'quiz') {
            const numQ = quiz_params?.num_questions || 10;
            console.log(`[${requestId}] 🎯 Chế độ: QUIZ | Số câu yêu cầu: ${numQ}`);
            const prompt = buildQuizPrompt(contextText, user_message, numQ);
            
            // XỬ LÝ VỚI FALLBACK LAYER
            const responseText = await executeWithFallback(async (modelName) => {
                const response = await ai.models.generateContent({
                    model: modelName,
                    contents: prompt,
                    config: {
                        temperature: 0.2,
                        responseMimeType: "application/json"
                    }
                });
                return response.text;
            });
            
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
            
            let isHeadersSent = false;

            // XỬ LÝ VỚI FALLBACK LAYER
            await executeWithFallback(async (modelName) => {
                const responseStream = await ai.models.generateContentStream({
                    model: modelName,
                    contents: prompt
                });

                // Nếu API Call thành công (không bị crash ở trên) -> Bắt đầu mở Stream trả về Client
                if (!isHeadersSent) {
                    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');
                    res.flushHeaders(); 
                    isHeadersSent = true;
                }

                for await (const chunk of responseStream) {
                    if (chunk.text) {
                        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
                    }
                }
            });

            if (isHeadersSent) {
                res.write('data: [DONE]\n\n');
                res.end();
            }
            console.log(`[${requestId}] ✅ Đã stream xong toàn bộ đoạn hội thoại.`);
        } 
        
        else {
            console.warn(`[${requestId}] ⚠️ Lỗi 400: Tham số feature [${feature}] không hợp lệ.`);
            return res.status(400).json({ error: "Tính năng không được hỗ trợ." });
        }

    } catch (error) {
        console.error(`[${requestId}] 🚨 LỖI HỆ THỐNG:`, error.message);
        
        if (!res.headersSent) {
            res.status(500).json({ 
                error: error.message || "Lỗi Server Internal.", 
                details: error.message 
            });
        }
    }
});

// ============================================================================
// 6. API HEALTH CHECK
// ============================================================================

app.get('/api/process', (req, res) => {
    res.status(200).send("✅ API Endpoint /api/process đang hoạt động. Hãy gọi bằng POST.");
});

// ============================================================================
// 7. ERROR HANDLING
// ============================================================================

app.use((req, res, next) => {
    res.status(404).json({ error: "Endpoint not found." });
});

app.use((err, req, res, next) => {
    console.error("🚨 GLOBAL ERROR:", err.stack);
    res.status(500).json({ error: "Something broke!" });
});

// ============================================================================
// 8. KHỞI ĐỘNG SERVER 
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log("=========================================================");
    console.log(`🚀 BẬT MÁY: AceQuiz Backend đang chạy tại port ${PORT}`);
    console.log(`🔒 Chế độ bảo mật cực mạnh đã được kích hoạt.`);
    console.log(`🤖 Sử dụng Model AI: Google Gemini 2.5 với cơ chế TỰ ĐỘNG FALLBACK`);
    console.log("=========================================================");
});