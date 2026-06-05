// ============================================================================
// ACEQUIZ AI BACKEND SYSTEM - OPENROUTER VERSION
// ============================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai'); // Dùng chuẩn OpenAI để kết nối OpenRouter

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

const API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const MODEL_NAME = (process.env.MODEL_NAME || 'google/gemini-2.0-flash-exp:free').trim();

if (!API_KEY) {
    console.error("=========================================================");
    console.error("🚨 LỖI CHÍ MẠNG: KHÔNG TÌM THẤY OPENROUTER_API_KEY!");
    console.error("🚨 Vui lòng kiểm tra tab Environment trên Render.");
    console.error("=========================================================");
    process.exit(1);
}

// Khởi tạo SDK OpenRouter (ĐÃ FIX SẠCH LỖI INVALID URL)
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: API_KEY
});

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
        console.log(`[${requestId}] 🤖 Chuẩn bị gọi model: [${MODEL_NAME}] tại OpenRouter`);

        if (feature === 'quiz') {
            const numQ = quiz_params?.num_questions || 10;
            console.log(`[${requestId}] 🎯 Chế độ: QUIZ | Số câu yêu cầu: ${numQ}`);
            
            const prompt = buildQuizPrompt(contextText, user_message, numQ);
            
            const response = await openai.chat.completions.create({
                model: MODEL_NAME,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.2 
            });

            const responseText = response.choices[0].message.content;
            
            try {
                // Xử lý an toàn để lọc JSON ra khỏi Markdown code block nếu OpenRouter cố tình trả về
                let cleanJson = responseText;
                const startIndex = cleanJson.indexOf('[');
                const endIndex = cleanJson.lastIndexOf(']');
                
                if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                    cleanJson = cleanJson.substring(startIndex, endIndex + 1);
                }

                const jsonData = JSON.parse(cleanJson);
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
            
            const stream = await openai.chat.completions.create({
                model: MODEL_NAME,
                messages: [{ role: "user", content: prompt }],
                stream: true,
            });

            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders(); 

            for await (const chunk of stream) {
                const chunkText = chunk.choices[0]?.delta?.content || "";
                if (chunkText) {
                    res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
                }
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
                error: "Lỗi Server Internal: API OpenRouter có thể đang từ chối truy cập hoặc quá tải.", 
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
    res.status(200).send("🚀 AceQuiz Backend System is Running Smoothly on OpenRouter...");
});

// ============================================================================
// 6. KHỞI ĐỘNG SERVER 
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log("=========================================================");
    console.log(`🚀 BẬT MÁY: AceQuiz Backend đang chạy tại port ${PORT}`);
    console.log(`🔒 Chế độ bảo mật cực mạnh đã được kích hoạt.`);
    console.log(`🌐 Đã bind port 0.0.0.0 để tương thích tuyệt đối với Render.`);
    console.log(`🤖 Đang cấu hình sử dụng Model AI: [${MODEL_NAME}]`);
    console.log("=========================================================");
});