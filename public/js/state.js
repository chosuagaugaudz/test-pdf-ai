export const safeParseJSON = (key, defaultVal) => {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : defaultVal;
  } catch (e) {
    return defaultVal;
  }
};

export const state = {
  docs: [], 
  chatHistory: [],
  isFetching: false, 
  currentWorkspace: 'chat',
  quizData: null, 
  quizAnswers: {}, 
  quizSubmitted: false,
  folders: safeParseJSON('folders', []),
  allChats: safeParseJSON('all_chats', []),
  currentChatId: localStorage.getItem('current_chat_id') || Date.now()
};

export const config = {
  // Use relative path so it dynamically points to the same server
  backendUrl: '/api/process',
  numQuestions: parseInt(localStorage.getItem('num_questions')) || 10
};

// Helper to save chats
export const saveChatToLocal = () => {
  if (state.chatHistory.length === 0) return;
  const existingIdx = state.allChats.findIndex(c => c.id.toString() === state.currentChatId.toString());
  
  let chatTitle = state.chatHistory[0].content.substring(0, 20);
  if(state.chatHistory[0].content.length > 20) chatTitle += '...';
  
  if(existingIdx >= 0) {
    state.allChats[existingIdx].messages = [...state.chatHistory];
  } else {
    state.allChats.unshift({ id: state.currentChatId, title: chatTitle, messages: [...state.chatHistory] });
  }
  
  localStorage.setItem('all_chats', JSON.stringify(state.allChats));
};
