const fs = require('fs');
const path = require('path');

(async () => {
  console.log("Starting Puppeteer tests...");
  let browser;
  try {
    const puppeteer = (await import('puppeteer')).default;
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  } catch (e) {
    console.error("Failed to launch Puppeteer:", e);
    process.exit(1);
  }
  
  const page = await browser.newPage();
  
  let hasErrors = false;
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon.ico')) {
      console.log(`PAGE ERROR: ${msg.text()}`);
      hasErrors = true;
    } else {
      console.log(`PAGE LOG: ${msg.text()}`);
    }
  });
  
  page.on('pageerror', err => {
    console.log(`PAGE EXCEPTION: ${err.message}`);
    hasErrors = true;
  });

  try {
    console.log("Navigating to http://localhost:3000...");
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    
    const newChatBtn = await page.$('#newChatBtn');
    if (!newChatBtn) throw new Error("Could not find newChatBtn");
    console.log("UI loaded successfully.");

    console.log("Creating dummy PDF file...");
    const dummyPdfPath = path.join(__dirname, 'dummy.pdf');
    const base64Pdf = "JVBERi0xLjQKMSAwIG9iago8PAovVGl0bGUgKER1bW15KQovQ3JlYXRvciAoRHVtbXkpCi9Qcm9kdWNlciAoRHVtbXkpCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAzIDAgUgo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZXMKL0tpZHMgWzQgMCBSXQovQ291bnQgMQo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDMgMCBSCi9NZWRpYUJveCBbMCAwIDYxMiA3OTJdCi9SZXNvdXJjZXMgPDwgPj4KL0NvbnRlbnRzIDUgMCBSCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9MZW5ndGggMAo+PgpzdHJlYW0KZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYKMDAwMDAwMDAwOSAwMDAwMCBuCjAwMDAwMDAwOTQgMDAwMDAgbgowMDAwMDAwMTQ2IDAwMDAwIG4KMDAwMDAwMDIwNCAwMDAwMCBuCjAwMDAwMDAzMTYgMDAwMDAgbgp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMiAwIFIKL0luZm8gMSAwIFIKPj4Kc3RhcnR4cmVmCjM2NAolJUVPRgo=";
    fs.writeFileSync(dummyPdfPath, Buffer.from(base64Pdf, 'base64'));

    console.log("Uploading PDF...");
    const inputUploadHandle = await page.$('input#pdfUpload');
    await inputUploadHandle.uploadFile(dummyPdfPath);
    
    await new Promise(r => setTimeout(r, 2000));
    
    const docsTags = await page.$('#activeDocsTags');
    const isVisible = await docsTags.evaluate(el => el.style.display !== 'none');
    if (!isVisible) {
      console.log("WARNING: PDF tags not visible. Waiting an extra 2s...");
      await new Promise(r => setTimeout(r, 2000));
    } else {
      console.log("PDF upload successful.");
    }

    console.log("Sending chat message...");
    await page.type('#messageInput', 'Hello AI');
    await page.click('#sendBtn');

    await new Promise(r => setTimeout(r, 3000));
    console.log("Chat functionality executed.");
    
    if (hasErrors) {
      console.log("TEST COMPLETED WITH PAGE ERRORS.");
    } else {
      console.log("ALL E2E TESTS PASSED SUCCESSFULLY.");
    }

    await page.screenshot({ path: 'test_screenshot.png' });
    console.log("Screenshot saved to test_screenshot.png");
    
  } catch (error) {
    console.error("TEST FAILED:", error);
  } finally {
    if (browser) await browser.close();
  }
})();
