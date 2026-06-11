import { state } from './state.js';
import { setStatus, showToast, renderDocsList } from './ui.js';

export const extractPdfText = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText.slice(0, 25000); 
};

export const addDocs = async (files) => {
  let addedCount = 0;
  setStatus('Đang xử lý PDF...', 'busy');
  
  for (const file of files) {
    if (!file.name.endsWith('.pdf')) {
      showToast(`${file.name} không phải PDF`, 'error');
      continue;
    }
    if (state.docs.some(d => d.name === file.name)) {
      showToast(`${file.name} đã tồn tại`, 'info');
      continue;
    }
    
    try {
      const content = await extractPdfText(file);
      state.docs.push({ id: Date.now() + Math.random(), name: file.name, content: content });
      addedCount++;
    } catch(e) {
      showToast(`Lỗi đọc ${file.name}: ${e.message}`, 'error');
    }
  }
  
  if (addedCount) {
    showToast(`Đã thêm ${addedCount} tài liệu`, 'success');
    renderDocsList();
  }
  
  setStatus(`Sẵn sàng (${state.docs.length} tài liệu)`, 'ready');
};

export const removeDoc = (id) => {
  state.docs = state.docs.filter(d => d.id !== id);
  renderDocsList();
  setStatus(`Sẵn sàng (${state.docs.length} tài liệu)`, 'ready');
  showToast('Đã xóa tài liệu', 'info');
};
