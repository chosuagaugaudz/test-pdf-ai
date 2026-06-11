import { state, config, saveChatToLocal } from './state.js';
import { 
  elements, setStatus, showToast, showTypingIndicator, removeTypingIndicator, 
  appendMessage, renderFolderList, renderChatHistoryList, switchWorkspace, 
  loadPastChat, loadQuiz, renderDocsList, scrollChatToBottom 
} from './ui.js';
import { addDocs, removeDoc } from './pdf.js';
import { sendApiRequest } from './api.js';

// Setup PDF worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// Init App
const initApp = () => {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  
  renderFolderList();
  renderChatHistoryList();
  
  const currentChat = state.allChats.find(c => c.id.toString() === state.currentChatId.toString());
  if(currentChat && currentChat.messages && currentChat.messages.length > 0) {
    loadPastChat(currentChat.id);
  } else {
    appendMessage('bot', 'Xin chào! Hãy tải lên file PDF và bắt đầu học nhé.', false);
  }
  setStatus('Sẵn sàng', 'ready');
};

document.addEventListener('DOMContentLoaded', initApp);

// Sidebar Events
document.getElementById('toggleSidebarBtn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

elements.newChatBtn.addEventListener('click', () => {
  state.chatHistory = [];
  state.currentChatId = Date.now(); 
  localStorage.setItem('current_chat_id', state.currentChatId);
  
  elements.chatMessages.innerHTML = '';
  appendMessage('bot', 'Xin chào! Hãy tải lên file PDF để bắt đầu học nhé.', false);
  switchWorkspace('chat');
  renderChatHistoryList(); 
  showToast('Đã bắt đầu cuộc trò chuyện mới', 'success');
});

document.getElementById('themeToggle').addEventListener('click', () => {
  const html = document.documentElement;
  const newTheme = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
});

// PDF Events
document.getElementById('pdfUpload').addEventListener('change', (e) => {
  if (e.target.files.length) addDocs(Array.from(e.target.files));
  e.target.value = '';
});

document.querySelector('.attach-btn').addEventListener('click', () => {
  document.getElementById('pdfUpload').click();
});

document.body.addEventListener('dragover', (e) => { e.preventDefault(); });
document.body.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) addDocs(Array.from(e.dataTransfer.files));
});

// Remove Doc dynamic event
document.addEventListener('click', (e) => {
  if (e.target.closest('.delete-doc-btn')) {
    const id = parseFloat(e.target.closest('.delete-doc-btn').dataset.id);
    removeDoc(id);
  }
  
  if (e.target.closest('.delete-folder-btn')) {
    const id = parseFloat(e.target.closest('.delete-folder-btn').dataset.id);
    state.folders = state.folders.filter(f => f.id !== id);
    localStorage.setItem('folders', JSON.stringify(state.folders));
    renderFolderList();
  }

  if (e.target.closest('.delete-chat-btn')) {
    const id = parseFloat(e.target.closest('.delete-chat-btn').dataset.id);
    state.allChats = state.allChats.filter(c => c.id !== id);
    localStorage.setItem('all_chats', JSON.stringify(state.allChats));
    if(id.toString() === state.currentChatId.toString()) {
      elements.newChatBtn.click(); 
    } else {
      renderChatHistoryList();
    }
  }
});

// Message Input
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

messageInput.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 150) + 'px';
  sendBtn.disabled = !this.value.trim() || state.isFetching;
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendBtn.click();
  }
});

// Send API Request
sendBtn.addEventListener('click', async () => {
  const text = messageInput.value.trim();
  if(!text || !state.docs.length) { 
    showToast('Vui lòng nạp PDF trước!', 'error'); 
    return; 
  }
  
  const normalizedText = text.normalize('NFC').toLowerCase();
  const isQuiz = /đề|trắc nghiệm|quiz|mcq|câu hỏi|test|exam|bài tập/i.test(normalizedText);

  messageInput.value = ''; 
  appendMessage('user', text);
  
  state.isFetching = true;
  sendBtn.disabled = true;
  setStatus('Đang xử lý...', 'busy');
  showTypingIndicator();

  const payload = {
    feature: isQuiz ? 'quiz' : 'summarize',
    user_message: text,
    documents: state.docs.map(d => ({ file_name: d.name, content: d.content })),
    conversation_history: state.chatHistory.slice(0, -1),
    quiz_params: { num_questions: config.numQuestions }
  };

  let botMessageDiv = null;

  await sendApiRequest(
    payload,
    (accumulated, isDone) => {
      if (!botMessageDiv) {
        removeTypingIndicator();
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message bot';
        msgDiv.innerHTML = `<div class="avatar">AI</div><div class="bubble markdown"></div>`;
        elements.chatMessages.appendChild(msgDiv);
        botMessageDiv = msgDiv.querySelector('.bubble');
      }
      botMessageDiv.innerHTML = marked.parse(accumulated);
      scrollChatToBottom();
      
      if (isDone && accumulated) {
        state.chatHistory.push({ role: 'bot', content: accumulated });
        saveChatToLocal(); 
      }
    },
    (quizData) => {
      removeTypingIndicator();
      if (quizData && Array.isArray(quizData) && quizData.length > 0) {
        loadQuiz(quizData);
        appendMessage('bot', `✅ Đã tạo thành công đề trắc nghiệm gồm ${quizData.length} câu. Chuyển sang chế độ làm bài...`, true);
        switchWorkspace('quiz');
      } else {
        appendMessage('bot', `⚠️ Lỗi định dạng từ AI. Xin hãy yêu cầu lại rõ ràng hơn (VD: "Tạo đề trắc nghiệm").`, true);
      }
    },
    (err) => {
      removeTypingIndicator();
      appendMessage('bot', `❌ Lỗi: ${err.message}.`, true);
      setStatus('Lỗi kết nối', 'error');
    }
  );

  state.isFetching = false;
  sendBtn.disabled = !messageInput.value.trim();
  setStatus(`Sẵn sàng (${state.docs.length} tài liệu)`, 'ready');
  messageInput.focus();
});

// Back to chat
document.getElementById('backToChatBtn').addEventListener('click', () => switchWorkspace('chat'));

// Quiz Interactions
elements.quizGrid.addEventListener('click', (e) => {
  const optionEl = e.target.closest('.quiz-option');
  if (optionEl && !state.quizSubmitted) {
    const qIndex = parseInt(optionEl.dataset.qindex);
    const key = optionEl.dataset.key;
    
    state.quizAnswers[qIndex] = key;
    
    const siblings = document.getElementById(`quiz-card-${qIndex}`).querySelectorAll('.quiz-option');
    siblings.forEach(s => s.classList.remove('selected'));
    optionEl.classList.add('selected');
  }
});

document.getElementById('submitQuizBtn').addEventListener('click', () => {
  if (state.quizSubmitted) return;
  state.quizSubmitted = true;
  
  let score = 0;
  state.quizData.forEach((q, index) => {
    const card = document.getElementById(`quiz-card-${index}`);
    const userAns = state.quizAnswers[index];
    const correctAns = q.answer;
    
    if (userAns === correctAns) {
      score++;
      card.classList.add('answered-correct');
    } else {
      card.classList.add('answered-wrong');
    }
    
    const options = card.querySelectorAll('.quiz-option');
    options.forEach(opt => {
      const k = opt.dataset.key;
      if (k === correctAns) opt.classList.add('correct');
      else if (k === userAns && userAns !== correctAns) opt.classList.add('wrong');
    });
    
    document.getElementById(`expl-${index}`).classList.add('show');
  });
  
  showToast(`Hoàn thành! Đúng ${score}/${state.quizData.length} câu.`, 'info');
});

// Modals
document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('backendUrl').value = config.backendUrl;
  document.getElementById('numQuestions').value = config.numQuestions;
  document.getElementById('settingsModal').classList.add('open');
});
document.getElementById('closeModalBtn').addEventListener('click', () => document.getElementById('settingsModal').classList.remove('open'));
document.getElementById('saveSettingsBtn').addEventListener('click', () => {
  config.numQuestions = parseInt(document.getElementById('numQuestions').value) || 10;
  localStorage.setItem('num_questions', config.numQuestions);
  document.getElementById('settingsModal').classList.remove('open');
  showToast('Cài đặt đã lưu', 'success');
});

document.getElementById('openFolderModalBtn').addEventListener('click', () => document.getElementById('folderModal').classList.add('open'));
document.getElementById('closeFolderModalBtn').addEventListener('click', () => document.getElementById('folderModal').classList.remove('open'));
document.getElementById('saveFolderBtn').addEventListener('click', () => {
  const name = document.getElementById('folderNameInput').value.trim();
  if(name) {
    state.folders.push({ id: Date.now(), name });
    localStorage.setItem('folders', JSON.stringify(state.folders));
    renderFolderList();
    document.getElementById('folderModal').classList.remove('open');
    document.getElementById('folderNameInput').value = '';
    showToast('Đã tạo môn học', 'success');
  }
});
