import { config } from './state.js';

export const sendApiRequest = async (payload, onStreamChunk, onQuizReady, onError) => {
  try {
    const response = await fetch(config.backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`Lỗi HTTP ${response.status}`);
    
    if (payload.feature === 'quiz') {
      let quizData = null;
      const contentType = response.headers.get('content-type');
      
      if (contentType && contentType.includes('application/json')) {
        const json = await response.json();
        quizData = json.data || json.quiz || json;
      } else {
        const rawText = await response.text();
        const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/) || rawText.match(/(\{[\s\S]*\})/);
        if (jsonMatch) { 
          try { 
            quizData = JSON.parse(jsonMatch[1]); 
          } catch(e) { 
            quizData = null; 
          } 
        }
      }
      onQuizReady(quizData);
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                accumulated += parsed.text;
                onStreamChunk(accumulated, false);
              }
            } catch(e) {}
          }
        }
      }
      onStreamChunk(accumulated, true);
    }
  } catch (err) {
    onError(err);
  }
};
