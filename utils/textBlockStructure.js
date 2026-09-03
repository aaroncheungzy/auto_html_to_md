(() => {
  function textToBlocks(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const blocks = [], paragraph = [], bullets = [];
    const flushParagraph = () => { if (paragraph.length) blocks.push({ type: 'p', text: paragraph.join(' ').trim() }); paragraph.length = 0; };
    const flushBullets = () => { if (bullets.length) blocks.push({ type: 'ul', items: bullets.splice(0) }); };
    lines.forEach((raw) => {
      const line = raw.trim();
      const bullet = line.match(/^[•●▪◦*-]\s*(.*)$/);
      if (!line) { flushParagraph(); flushBullets(); return; }
      if (bullet) { flushParagraph(); if (bullet[1]) bullets.push(bullet[1]); return; }
      flushBullets(); paragraph.push(line);
    });
    flushParagraph(); flushBullets();
    return blocks;
  }
  const api = { textToBlocks };
  if (typeof window !== 'undefined') window.TextBlockStructure = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
