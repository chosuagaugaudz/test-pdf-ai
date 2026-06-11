import { state, saveChatToLocal } from './state.js';
import { removeDoc } from './pdf.js';

// DOM Elements
export const elements = {
  statusBadge: document.getElementById('statusBadge'),
  toastStack: document.getElementById('toastStack'),
  chatContainer: document.getElementById('chatContainer'),
  chatMessages: document.getElementById('chatMessages'),
  chatHistoryList: document.getElementById('chatHistoryList'),
  folderList: document.getElementById('folderList'),
  pdfList: document.getElementById('pdfList'),
  emptyDocs: document.getElementById('emptyDocs'),
  activeDocsTags: document.getElementById('activeDocsTags'),
  chatWorkspace: document.getElementById('chatWorkspace'),
  quizWorkspace: document.getElementById('quizWorkspace'),
  quizGrid: document.getElementById('quizGrid'),
  quizTitle: document.getElementById('quizTitle'),
  newChatBtn: document.getElementById('newChatBtn')
};

export const setStatus = (text, type = '') => {
  elements.statusBadge.textContent = text;
  elements.statusBadge.className = 'status ' + type;
};

export const showToast = (msg, type = 'info') => {
  const t = document.createElement('div'); 
  t.className = `toast ${type}`; 
  
  // Icon based on type
  let icon = 'ℹ️';
  if(type === 'success') icon = '✅';
  if(type === 'error') icon = '❌';
  if(type === 'warning') icon = '⚠️';
  
  t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  elements.toastStack.appendChild(t); 
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(100%)';
    setTimeout(() => t.remove(), 300);
  }, 3000);
};

export const scrollChatToBottom = () => {
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
};

export const showTypingIndicator = () => {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message bot typing-indicator';
  typingDiv.id = 'typingIndicator';
  typingDiv.innerHTML = `<div class="avatar">AI</div><div class="bubble typing"><span></span><span></span><span></span></div>`;
  elements.chatMessages.appendChild(typingDiv);
  scrollChatToBottom();
};

export const removeTypingIndicator = () => {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
};

export const appendMessage = (role, content, save = true) => {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  messageDiv.innerHTML = `
    <div class="avatar">${role === 'user' ? 'U' : 'AI'}</div>
    <div class="bubble markdown">${role === 'user' ? content : marked.parse(content)}</div>
  `;
  elements.chatMessages.appendChild(messageDiv);
  scrollChatToBottom();

  if (save && role !== 'typing') {
    state.chatHistory.push({ role, content });
    saveChatToLocal();
    renderChatHistoryList();
  }
};

export const switchWorkspace = (workspace) => {
  if (workspace === 'chat') {
    elements.chatWorkspace.classList.remove('hidden');
    elements.quizWorkspace.classList.add('hidden');
    state.currentWorkspace = 'chat';
  } else {
    elements.chatWorkspace.classList.add('hidden');
    elements.quizWorkspace.classList.remove('hidden');
    state.currentWorkspace = 'quiz';
  }
};

export const renderFolderList = () => {
  elements.folderList.innerHTML = '';
  if(state.folders.length === 0) {
    elements.folderList.innerHTML = '<li style="color: var(--text-tertiary); font-size: 12px; font-style: italic; padding: 0 12px;">Chưa có môn học</li>';
    return;
  }
  state.folders.forEach(f => {
    const li = document.createElement('li');
    li.className = 'folder-item';
    li.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">${f.name}</span>
      </div>
      <button class="pdf-delete delete-folder-btn" data-id="${f.id}" style="padding:2px; font-size:14px;">✕</button>
    `;
    li.onclick = (e) => {
      if(!e.target.closest('.delete-folder-btn')) {
        document.querySelectorAll('.folder-item').forEach(i => i.classList.remove('active'));
        li.classList.add('active');
        showToast(`Đã mở môn: ${f.name}`, 'info');
      }
    };
    elements.folderList.appendChild(li);
  });
};

export const renderChatHistoryList = () => {
  elements.chatHistoryList.innerHTML = '';
  if(state.allChats.length === 0) {
    elements.chatHistoryList.innerHTML = '<li style="color: var(--text-tertiary); font-size: 12px; font-style: italic; padding: 0 12px;">Trống</li>';
    return;
  }
  state.allChats.forEach(chat => {
    const li = document.createElement('li');
    li.className = `folder-item ${chat.id.toString() === state.currentChatId.toString() ? 'active' : ''}`;
    li.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span>💬</span>
        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">${chat.title}</span>
      </div>
      <button class="pdf-delete delete-chat-btn" data-id="${chat.id}" style="padding:2px; font-size:14px;">✕</button>
    `;
    li.onclick = (e) => {
      if(!e.target.closest('.delete-chat-btn')) loadPastChat(chat.id);
    };
    elements.chatHistoryList.appendChild(li);
  });
};

export const loadPastChat = (id) => {
  const chat = state.allChats.find(c => c.id === id);
  if(chat) {
    state.currentChatId = chat.id;
    localStorage.setItem('current_chat_id', state.currentChatId);
    state.chatHistory = [...chat.messages];
    
    elements.chatMessages.innerHTML = '';
    state.chatHistory.forEach(m => {
      const msgDiv = document.createElement('div');
      msgDiv.className = `message ${m.role}`;
      msgDiv.innerHTML = `
        <div class="avatar">${m.role === 'user' ? 'U' : 'AI'}</div>
        <div class="bubble markdown">${m.role === 'user' ? m.content : marked.parse(m.content)}</div>
      `;
      elements.chatMessages.appendChild(msgDiv);
    });
    
    switchWorkspace('chat');
    scrollChatToBottom();
    renderChatHistoryList();
  }
};

export const renderDocsList = () => {
  elements.pdfList.innerHTML = '';
  if (state.docs.length === 0) {
    elements.emptyDocs.style.display = 'block';
    elements.activeDocsTags.style.display = 'none';
    return;
  }
  
  elements.emptyDocs.style.display = 'none';
  elements.activeDocsTags.style.display = 'flex';
  elements.activeDocsTags.innerHTML = '';

  state.docs.forEach(doc => {
    // Sidebar list
    const li = document.createElement('li');
    li.className = 'pdf-item';
    li.innerHTML = `
      <span class="pdf-name">📄 ${doc.name}</span>
      <button class="pdf-delete delete-doc-btn" data-id="${doc.id}">✕</button>
    `;
    elements.pdfList.appendChild(li);

    // Tags below input
    const tag = document.createElement('div');
    tag.className = 'doc-tag';
    tag.innerHTML = `
      <span>📄 ${doc.name.length > 20 ? doc.name.slice(0,20)+'…' : doc.name}</span>
      <button class="delete-doc-btn" data-id="${doc.id}">✕</button>
    `;
    elements.activeDocsTags.appendChild(tag);
  });
};

export const loadQuiz = (quizArray) => {
  state.quizData = quizArray;
  state.quizAnswers = {};
  state.quizSubmitted = false;
  elements.quizTitle.textContent = `Đề trắc nghiệm — ${quizArray.length} câu`;
  elements.quizGrid.innerHTML = '';
  
  quizArray.forEach((q, index) => {
    const card = document.createElement('div');
    card.className = 'quiz-card';
    card.id = `quiz-card-${index}`;
    
    let optionsHtml = '';
    for (const [key, val] of Object.entries(q.options)) {
      optionsHtml += `
        <div class="quiz-option" data-qindex="${index}" data-key="${key}">
          <div style="width:24px; height:24px; border-radius:50%; border:1px solid var(--border); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:600; background:var(--bg-primary);">${key}</div>
          <div style="flex:1;">${val}</div>
        </div>
      `;
    }
    
    card.innerHTML = `
      <div class="quiz-question-text">Câu ${index + 1}: ${q.question}</div>
      <div class="quiz-options">${optionsHtml}</div>
      <div class="quiz-explanation" id="expl-${index}">
        <strong>Giải thích:</strong> ${q.explanation}
      </div>
    `;
    elements.quizGrid.appendChild(card);
  });
};
