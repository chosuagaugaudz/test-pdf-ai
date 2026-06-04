require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Sử dụng package SDK thế hệ mới của Google (@google/genai)
let GoogleGenAI;
try {
  GoogleGenAI = require('@google/genai').GoogleGenAI;
} catch (e) {
  console.error("Không tìm thấy package '@google/genai'. Vui lòng chạy lệnh: npm install @google/genai");
  process.exit(1);
}

const summarizePrompt = require("./prompts/summarize");
const quizPrompt = require("./prompts/quiz");

const app = express();
app.use(cors());
app.use(helmet());

// Giới hạn payload nhận file text PDF lên đến 50MB
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Bộ lọc chống spam (15 phút tối đa 100 yêu cầu/mỗi IP)
const limiter = rateLimit({ windowMs: 15*60*1000, max: 100 });
app.use(limiter);

// Khởi tạo Client Gemini thế hệ mới
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const PORT = process.env.PORT || 3000;
const FREE_LIMIT = parseInt(process.env.FREE_LIMIT) || 100;
const MODEL_NAME = process.env.MODEL_NAME || 'gemini-2.5-flash';

// RAM ảo theo dõi lượt dùng của sinh viên
const usageStore = new Map();

/**
 * Hàm SmartTrim: Giữ 50% đầu, 30% giữa, 20% cuối của tài liệu 
 * Khống chế dung lượng chữ đầu vào để tránh dính lỗi nghẽn băng thông 429
 */
function smartTrim(text, maxChars = 80000) {
  if (text.length <= maxChars) return text;
  const headLen = Math.floor(maxChars * 0.5);
  const tailLen = Math.floor(maxChars * 0.2);
  const middleLen = maxChars - headLen - tailLen;
  const middleStart = Math.floor((text.length - middleLen) / 2);
  const head = text.slice(0, headLen);
  const middle = text.slice(middleStart, middleStart + middleLen);
  const tail = text.slice(text.length - tailLen);
  return `${head}\n\n...[TRUNCATED]...\n\n${middle}\n\n...[TRUNCATED]...\n\n${tail}`;
}

function buildDocumentContext(documents = []) {
  return documents.map(doc => {
    const content = smartTrim(doc.content || '', 80000);
    return `=== TÀI LIỆU: ${doc.file_name} ===\nSố trang: ${doc.page_count}\n\n${content}`;
  }).join("\n\n-----------------\n\n");
}

function buildGeminiContents(payload) {
  const contents = [];
  const docContext = buildDocumentContext(payload.documents || []);
  if (docContext) {
    contents.push({ role: "user", parts: [{ text: docContext }] });
    contents.push({ role: "model", parts: [{ text: "Tôi đã đọc xong tài liệu. Bạn muốn tôi làm gì?" }] });
  }
  if (Array.isArray(payload.conversation_history)) {
    for (const msg of payload.conversation_history) {
      if (msg.content && typeof msg.content === 'string') {
        contents.push({
          role: (msg.role === 'assistant' ? 'model' : 'user'),
          parts: [{ text: msg.content }]
        });
      }
    }
  }
  if (payload.user_message) {
    contents.push({ role: "user", parts: [{ text: payload.user_message }] });
  }
  return contents;
}

/**
 * Xác thực cấu trúc mảng trắc nghiệm khớp 100% với form đồ họa Moodle Front-end
 */
function validateQuizSchema(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return false;
    const requiredKeys = ['question', 'options', 'answer', 'explanation'];
    for (const k of requiredKeys) {
      if (!(k in item)) return false;
    }
    if (!['A', 'B', 'C', 'D'].includes(item.answer)) return false;
    const opts = item.options;
    if (typeof opts !== 'object' || !opts.A || !opts.B || !opts.C || !opts.D) return false;
  }
  return true;
}

// ROUTE CHÍNH LIÊN KẾT HỆ THỐNG
app.post('/api/process', async (req, res) => {
  try {
    const payload = req.body;
    const { feature, user_id, quiz_params } = payload;

    if (!user_id) {
      return res.status(400).json({ success: false, error: "user_id không được để trống." });
    }
    const currentUsage = usageStore.get(user_id) || 0;
    if (currentUsage >= FREE_LIMIT) {
      return res.status(403).json({ success: false, error: `Bạn đã hết ${FREE_LIMIT} lượt miễn phí.` });
    }

    // TÍNH NĂNG 1: TÓM TẮT TÀI LIỆU (STREAMING CHUẨN SSE)
    if (feature === 'summarize') {
      const contents = buildGeminiContents(payload);
      let responseStream;
      
      try {
        responseStream = await ai.models.generateContentStream({
          model: MODEL_NAME,
          contents: contents,
          config: { systemInstruction: summarizePrompt }
        });
      } catch (err) {
        console.error("Lỗi gọi generateContentStream:", err.message);
        return res.status(500).json({ success: false, error: "Lỗi kết nối API Gemini: " + err.message });
      }

      // Đổ chữ thành công -> Tính phí
      usageStore.set(user_id, currentUsage + 1);
      
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      try {
        for await (const chunk of responseStream) {
          const textChunk = chunk.text;
          if (textChunk) {
            res.write(`data: ${JSON.stringify({ text: textChunk })}\n\n`);
          }
        }
      } catch (err) {
        console.error("Lỗi rò rỉ luồng stream văn bản:", err);
      }
      
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // TÍNH NĂNG 2: TẠO ĐỀ TRẮC NGHIỆM MOODLE TƯƠNG TÁC (CẤU HÌNH TỐI ƯU CHỐNG TRÀN)
    if (feature === 'quiz') {
      const numQ = quiz_params?.num_questions || 5;
      
      // Chiến thuật ép chữ ngắn gọn để gom đủ 20 - 50 câu trắc nghiệm mà không bị rách file JSON đầu ra
      const quizInstruction = `Bạn là một chuyên gia khảo thí học thuật. Hãy tạo chính xác đúng ${numQ} câu hỏi trắc nghiệm khách quan từ tài liệu được cung cấp.
      BẮT BUỘC TUÂN THỦ KHẮT KHE CHIẾN THUẬT TIẾT KIỆM KÝ TỰ:
      1. Câu hỏi và các tùy chọn A, B, C, D phải viết ngắn gọn, đi thẳng vào trọng tâm kiến thức.
      2. Phần 'explanation' (giải thích lý do) BẮT BUỘC chỉ được giải thích đúng 1 câu duy nhất và không được phép quá 15 từ.
      Tuyệt đối không viết văn hoa, dông dài để tránh bị kích hoạt trần giới hạn ký tự đầu ra (Max Output Tokens)!`;

      let result;
      try {
        const fullContents = buildGeminiContents(payload);
        fullContents.push({ role: "user", parts: [{ text: quizInstruction }] });

        result = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: fullContents,
          config: { 
            systemInstruction: quizPrompt,
            responseMimeType: "application/json" 
          }
        });
      } catch (err) {
        console.error("Lỗi gọi generateContent:", err.message);
        return res.status(500).json({ success: false, error: "Lỗi kết nối API Gemini: " + err.message });
      }

      const raw = result.text;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        // Cơ chế cứu hộ bóc tách mảng nếu có ký tự lạ bao bọc ngoài rìa
        const start = raw.indexOf('[');
        const end = raw.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end > start) {
          try {
            parsed = JSON.parse(raw.slice(start, end + 1));
          } catch (e2) {
            return res.status(500).json({ success: false, error: "AI bị nghẽn mạch do số câu quá dài làm hỏng cấu trúc file. Vui lòng chia nhỏ thành 15 câu mỗi lượt để cày đề mượt nhất." });
          }
        } else {
          return res.status(500).json({ success: false, error: "Cấu trúc đề thi trả về bị sứt sẹo, không thể giải mã." });
        }
      }

      if (!validateQuizSchema(parsed)) {
        return res.status(500).json({ success: false, error: "Cấu trúc đề thi không khớp với khuôn trắc nghiệm tương tác." });
      }

      // Trả đề sạch về thành công -> Trừ tiền
      usageStore.set(user_id, currentUsage + 1);
      return res.json({ success: true, data: parsed });
    }

    return res.status(400).json({ success: false, error: "Feature không hợp lệ." });

  } catch (error) {
    console.error("🚨 Lỗi sập hệ thống cục bộ:", error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: "Lỗi hệ thống: " + error.message })}\n\n`);
      return res.end();
    }
    return res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// BỘ GIÁP BẤT TỬ: Nuốt trọn lỗi bất ngờ phát sinh chống sập nguồn Terminal tuyệt đối
process.on('unhandledRejection', reason => console.error("🚨 REJECTION CHƯA BẮT LỖI:", reason));
process.on('uncaughtException', err => console.error("🚨 EXCEPTION CHÍ MẠNG:", err.message));

app.listen(PORT, () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
});